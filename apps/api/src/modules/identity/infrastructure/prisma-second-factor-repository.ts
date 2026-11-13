import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { IdGenerator } from '../../../shared/domain';
import type { NewTrustedDevice, TotpState, TrustedDeviceSummary } from '../domain/second-factor';
import { SecondFactorRepository, TrustedDeviceRepository } from '../domain/second-factor.ports';

/** Annule une transaction sans erreur à remonter. */
class Rollback extends Error {
  constructor() {
    super('Transaction annulée');
  }
}

/**
 * TOTP et codes de secours (AUTH-10, AUTH-11, SEC-22). Requêtes paramétrées seulement (SEC-11) ;
 * chaque condition est dans la requête qui écrit, pour que deux requêtes concurrentes ne
 * réussissent jamais toutes deux. L'époque n'est jamais écrite en arrière (`GREATEST`, ADR 0014).
 */
@Injectable()
export class PrismaSecondFactorRepository extends SecondFactorRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdGenerator,
  ) {
    super();
  }

  async findTotp(accountId: string): Promise<TotpState | null> {
    const row = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { totpSecretEnc: true, totpEnabledAt: true, totpLastStep: true },
    });
    return row
      ? {
          secretEnc: row.totpSecretEnc ? new Uint8Array(row.totpSecretEnc) : null,
          enabled: row.totpEnabledAt !== null,
          lastStep: row.totpLastStep,
        }
      : null;
  }

  async startEnrollment(accountId: string, secretEnc: Uint8Array, now: Date): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "account" SET "totp_secret_enc" = ${Buffer.from(secretEnc)}, "updated_at" = ${now}
      WHERE "id" = ${accountId}::uuid AND "totp_enabled_at" IS NULL`;
    return updated === 1;
  }

  async activate(input: {
    accountId: string;
    secretEnc: Uint8Array;
    step: number;
    recoveryCodeHashes: readonly string[];
    authEpoch: number;
    now: Date;
  }): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Le secret vérifié doit être toujours celui en attente : une inscription concurrente
        // l'aurait remplacé, et le code n'en prouverait rien.
        const activated = await tx.$executeRaw`
          UPDATE "account"
          SET "totp_enabled_at" = ${input.now}, "totp_last_step" = ${input.step},
              "auth_epoch" = GREATEST("auth_epoch", ${input.authEpoch}),
              "updated_at" = ${input.now}
          WHERE "id" = ${input.accountId}::uuid
            AND "totp_enabled_at" IS NULL
            AND "totp_secret_enc" = ${Buffer.from(input.secretEnc)}`;
        if (activated !== 1) throw new Rollback();
        await this.writeRecoveryCodes(tx, input.accountId, input.recoveryCodeHashes, input.now);
      });
      return true;
    } catch (error) {
      if (error instanceof Rollback) return false;
      throw error;
    }
  }

  async consumeStep(accountId: string, step: number): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "account" SET "totp_last_step" = ${step}
      WHERE "id" = ${accountId}::uuid
        AND "totp_enabled_at" IS NOT NULL
        AND ("totp_last_step" IS NULL OR "totp_last_step" < ${step})`;
    return updated === 1;
  }

  async consumeRecoveryCode(accountId: string, codeHash: string, now: Date): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "recovery_code" AS c SET "used_at" = ${now}, "updated_at" = ${now}
      FROM "account" AS a
      WHERE c."account_id" = ${accountId}::uuid
        AND c."code_hash" = ${codeHash}
        AND c."used_at" IS NULL
        AND a."id" = c."account_id"
        AND a."totp_enabled_at" IS NOT NULL`;
    return updated === 1;
  }

  async replaceRecoveryCodes(
    accountId: string,
    codeHashes: readonly string[],
    now: Date,
  ): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Verrou sur le compte : une désactivation concurrente attend, ou a déjà eu lieu.
        const enabled = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "account"
          WHERE "id" = ${accountId}::uuid AND "totp_enabled_at" IS NOT NULL
          FOR UPDATE`;
        if (enabled.length === 0) throw new Rollback();
        await this.writeRecoveryCodes(tx, accountId, codeHashes, now);
      });
      return true;
    } catch (error) {
      if (error instanceof Rollback) return false;
      throw error;
    }
  }

  async countUnusedRecoveryCodes(accountId: string): Promise<number> {
    return this.prisma.recoveryCode.count({ where: { accountId, usedAt: null } });
  }

  async disable(accountId: string, authEpoch: number, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.$executeRaw`
        UPDATE "account"
        SET "totp_secret_enc" = NULL, "totp_enabled_at" = NULL, "totp_last_step" = NULL,
            "auth_epoch" = GREATEST("auth_epoch", ${authEpoch}),
            "updated_at" = ${now}
        WHERE "id" = ${accountId}::uuid`;
      if (updated !== 1) throw new Error('Compte introuvable');
      await tx.recoveryCode.deleteMany({ where: { accountId } });
      // Un appareil de confiance ne dispense que du TOTP : sans lui, il n'a plus d'objet, et ne
      // doit pas dispenser d'un TOTP réactivé plus tard.
      await tx.trustedDevice.updateMany({
        where: { accountId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
  }

  private async writeRecoveryCodes(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    accountId: string,
    codeHashes: readonly string[],
    now: Date,
  ): Promise<void> {
    await tx.recoveryCode.deleteMany({ where: { accountId } });
    await tx.recoveryCode.createMany({
      data: codeHashes.map((codeHash) => ({
        id: this.ids.next(),
        accountId,
        codeHash,
        createdAt: now,
      })),
    });
  }
}

/** Appareils de confiance (AUTH-12, ADR 0013). Jeton en SHA-256, jamais en clair. */
@Injectable()
export class PrismaTrustedDeviceRepository extends TrustedDeviceRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(device: NewTrustedDevice): Promise<void> {
    await this.prisma.trustedDevice.create({
      data: {
        id: device.id,
        accountId: device.accountId,
        tokenHash: device.tokenHash,
        userAgent: device.userAgent,
        createdAt: device.createdAt,
        expiresAt: device.expiresAt,
      },
    });
  }

  async findActive(
    tokenHash: string,
    now: Date,
  ): Promise<{ id: string; accountId: string } | null> {
    return this.prisma.trustedDevice.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      select: { id: true, accountId: true },
    });
  }

  async listActive(accountId: string, now: Date): Promise<TrustedDeviceSummary[]> {
    return this.prisma.trustedDevice.findMany({
      where: { accountId, revokedAt: null, expiresAt: { gt: now } },
      select: { id: true, userAgent: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(accountId: string, deviceId: string, now: Date): Promise<boolean> {
    const { count } = await this.prisma.trustedDevice.updateMany({
      where: { id: deviceId, accountId, revokedAt: null },
      data: { revokedAt: now },
    });
    return count === 1;
  }
}
