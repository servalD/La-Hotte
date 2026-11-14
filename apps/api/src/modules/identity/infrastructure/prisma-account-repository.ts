import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import type {
  AccountCredentials,
  AccountTokenPurpose,
  ConsumedAccountToken,
  NewAccount,
  NewAccountToken,
} from '../domain/account';
import { AccountRepository } from '../domain/account.ports';

const CREDENTIALS = {
  id: true,
  email: true,
  passwordHash: true,
  status: true,
  emailVerifiedAt: true,
  totpEnabledAt: true,
} as const;

type CredentialsRow = Prisma.AccountGetPayload<{ select: typeof CREDENTIALS }>;

function toCredentials(row: CredentialsRow): AccountCredentials {
  return {
    accountId: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    active: row.status === 'ACTIVE',
    emailVerified: row.emailVerifiedAt !== null,
    totpEnabled: row.totpEnabledAt !== null,
  };
}

/** Annulation de la transaction d'annulation d'un changement d'e-mail, avec sa raison. */
class CancelRollback extends Error {
  constructor(readonly status: 'invalid' | 'taken') {
    super('Annulation abandonnée');
  }
}

/**
 * Usage unique : un seul UPDATE … RETURNING, deux requêtes concurrentes ne consomment jamais le
 * même jeton. Utilisable seul ou dans une transaction.
 */
async function consumeWith(
  client: Pick<PrismaService, '$queryRaw'> | Prisma.TransactionClient,
  tokenHash: string,
  purposes: readonly AccountTokenPurpose[],
  now: Date,
): Promise<ConsumedAccountToken | null> {
  const rows = await client.$queryRaw<
    {
      account_id: string;
      purpose: AccountTokenPurpose;
      new_email: string | null;
      created_at: Date;
    }[]
  >`
    UPDATE "account_token" AS t
    SET "used_at" = ${now}, "updated_at" = ${now}
    FROM "account" AS a
    WHERE t."token_hash" = ${tokenHash}
      AND t."used_at" IS NULL
      AND t."expires_at" > ${now}
      AND t."purpose"::text = ANY(${[...purposes]}::text[])
      AND a."id" = t."account_id"
      AND a."status" = 'ACTIVE'
    RETURNING t."account_id", t."purpose"::text AS "purpose", t."new_email", t."created_at"`;
  const row = rows[0];
  return row
    ? {
        accountId: row.account_id,
        purpose: row.purpose,
        newEmail: row.new_email,
        createdAt: row.created_at,
      }
    : null;
}

/** Violation d'unicité (adresse déjà prise). */
function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  // Requête brute (`$executeRaw`) : `P2010`, avec le code PostgreSQL `23505` dans `meta`.
  return (
    error.code === 'P2002' ||
    (error.code === 'P2010' && (error.meta as { code?: unknown } | undefined)?.code === '23505')
  );
}

/**
 * Adaptateur PostgreSQL du port `AccountRepository`. Requêtes paramétrées seulement (SEC-11) ;
 * l'époque n'est jamais écrite en arrière (`GREATEST`, ADR 0014).
 */
@Injectable()
export class PrismaAccountRepository extends AccountRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findByEmail(email: string): Promise<AccountCredentials | null> {
    const row = await this.prisma.account.findUnique({ where: { email }, select: CREDENTIALS });
    return row ? toCredentials(row) : null;
  }

  async findById(accountId: string): Promise<AccountCredentials | null> {
    const row = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: CREDENTIALS,
    });
    return row ? toCredentials(row) : null;
  }

  async create(
    account: NewAccount,
    verifyToken: NewAccountToken,
  ): Promise<'created' | 'email_taken'> {
    try {
      await this.prisma.$transaction([
        this.prisma.account.create({
          data: {
            id: account.id,
            email: account.email,
            passwordHash: account.passwordHash,
            ageAttestedAt: account.ageAttestedAt,
            createdAt: account.createdAt,
            pendingInvitationId: account.pendingInvitationId ?? null,
          },
        }),
        this.prisma.profile.create({
          data: { ...account.profile, accountId: account.id, createdAt: account.createdAt },
        }),
        this.prisma.accountToken.create({ data: verifyToken }),
      ]);
      return 'created';
    } catch (error) {
      if (isUniqueViolation(error)) return 'email_taken';
      throw error;
    }
  }

  async issueToken(token: NewAccountToken): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (token.purpose !== 'EMAIL_CHANGE_CANCEL') {
        await tx.accountToken.updateMany({
          where: { accountId: token.accountId, purpose: token.purpose, usedAt: null },
          data: { usedAt: token.createdAt },
        });
      }
      await tx.accountToken.create({ data: token });
    });
  }

  async consumeToken(
    tokenHash: string,
    purposes: readonly AccountTokenPurpose[],
    now: Date,
  ): Promise<ConsumedAccountToken | null> {
    return consumeWith(this.prisma, tokenHash, purposes, now);
  }

  async findOpenToken(
    tokenHash: string,
    purposes: readonly AccountTokenPurpose[],
    now: Date,
  ): Promise<ConsumedAccountToken | null> {
    const row = await this.prisma.accountToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: now },
        purpose: { in: [...purposes] },
        account: { is: { status: 'ACTIVE' } },
      },
      select: { accountId: true, purpose: true, newEmail: true, createdAt: true },
    });
    return row;
  }

  async isEmailReserved(
    email: string,
    exceptAccountId: string | null,
    now: Date,
  ): Promise<boolean> {
    const found = await this.prisma.accountToken.findFirst({
      where: {
        purpose: 'EMAIL_CHANGE_CANCEL',
        newEmail: email,
        usedAt: null,
        expiresAt: { gt: now },
        ...(exceptAccountId ? { accountId: { not: exceptAccountId } } : {}),
      },
      select: { id: true },
    });
    return found !== null;
  }

  async markEmailVerified(accountId: string, now: Date): Promise<void> {
    await this.prisma.account.updateMany({
      where: { id: accountId, emailVerifiedAt: null },
      data: { emailVerifiedAt: now, pendingInvitationId: null },
    });
  }

  /**
   * AUTH-06 : la réinitialisation vérifie l'adresse (le lien le prouve), sauf pour un compte qui
   * attend une invitation (AUTH-09) : il se vérifie par son lien, qui la consomme.
   */
  async setPassword(input: {
    accountId: string;
    passwordHash: string;
    authEpoch: number;
    reset: boolean;
    verifyEmail?: boolean;
    now: Date;
  }): Promise<void> {
    const verify = input.reset && (input.verifyEmail ?? true);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.$executeRaw`
        UPDATE "account"
        SET "password_hash" = ${input.passwordHash},
            "auth_epoch" = GREATEST("auth_epoch", ${input.authEpoch}),
            "email_verified_at" = CASE WHEN ${verify} AND "pending_invitation_id" IS NULL
              THEN COALESCE("email_verified_at", ${input.now}) ELSE "email_verified_at" END,
            "updated_at" = ${input.now}
        WHERE "id" = ${input.accountId}::uuid`;
      if (updated !== 1) throw new Error('Compte introuvable');
      if (!input.reset) return;
      // AUTH-06 : appareils de confiance révoqués, autres liens de réinitialisation invalidés.
      await tx.trustedDevice.updateMany({
        where: { accountId: input.accountId, revokedAt: null },
        data: { revokedAt: input.now },
      });
      await tx.accountToken.updateMany({
        where: { accountId: input.accountId, purpose: 'PASSWORD_RESET', usedAt: null },
        data: { usedAt: input.now },
      });
    });
  }

  async changeEmail(accountId: string, newEmail: string, now: Date): Promise<boolean> {
    if (await this.isEmailReserved(newEmail, accountId, now)) return false;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.account.update({
          where: { id: accountId },
          data: { email: newEmail, emailVerifiedAt: now },
        });
        // Un lien de vérification émis pour l'ancienne adresse ne vérifie pas la nouvelle.
        await tx.accountToken.updateMany({
          where: { accountId, purpose: { in: ['EMAIL_VERIFY', 'EMAIL_CHANGE'] }, usedAt: null },
          data: { usedAt: now },
        });
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async restoreEmail(input: {
    tokenHash: string;
    accountId: string;
    authEpoch: number;
    now: Date;
  }): Promise<{ status: 'restored'; email: string } | { status: 'invalid' | 'taken' }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Consommé dans la transaction : si la suite échoue, le lien reste utilisable.
        const token = await consumeWith(tx, input.tokenHash, ['EMAIL_CHANGE_CANCEL'], input.now);
        if (token?.accountId !== input.accountId || !token.newEmail) {
          throw new CancelRollback('invalid');
        }
        const email = token.newEmail;
        // Adresse rétablie seulement si personne d'autre ne l'a prise ; sinon rien n'est écrit.
        const restored = await tx.$executeRaw`
          UPDATE "account" SET "email" = ${email}, "updated_at" = ${input.now}
          WHERE "id" = ${input.accountId}::uuid
            AND NOT EXISTS (
              SELECT 1 FROM "account" WHERE "email" = ${email} AND "id" <> ${input.accountId}::uuid
            )`;
        if (restored !== 1) throw new CancelRollback('taken');
        // Le mot de passe est effacé : celui qui a demandé le changement le connaît (AUTH-16).
        await tx.$executeRaw`
          UPDATE "account"
          SET "auth_epoch" = GREATEST("auth_epoch", ${input.authEpoch}),
              "password_hash" = NULL,
              "updated_at" = ${input.now}
          WHERE "id" = ${input.accountId}::uuid`;
        // Liens envoyés pendant le détournement : désarmés. Les liens d'annulation plus anciens
        // que celui-ci restent valables ; les plus récents, non.
        await tx.accountToken.updateMany({
          where: {
            accountId: input.accountId,
            usedAt: null,
            OR: [
              { purpose: { in: ['EMAIL_VERIFY', 'EMAIL_CHANGE', 'PASSWORD_RESET'] } },
              { purpose: 'EMAIL_CHANGE_CANCEL', createdAt: { gt: token.createdAt } },
            ],
          },
          data: { usedAt: input.now },
        });
        return { status: 'restored' as const, email };
      });
    } catch (error) {
      if (error instanceof CancelRollback) return { status: error.status };
      // Inscription concurrente de la même adresse entre le contrôle et l'écriture.
      if (isUniqueViolation(error)) return { status: 'taken' };
      throw error;
    }
  }

  async findUnverifiedBefore(cutoff: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.account.findMany({
      where: { emailVerifiedAt: null, createdAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => row.id);
  }

  async suspendUnverified(accountId: string, cutoff: Date, authEpoch: number): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "account" SET "auth_epoch" = GREATEST("auth_epoch", ${authEpoch})
        WHERE "id" = ${accountId}::uuid`;
      const suspended = await tx.$executeRaw`
        UPDATE "account" SET "status" = 'SUSPENDED', "updated_at" = now()
        WHERE "id" = ${accountId}::uuid
          AND "email_verified_at" IS NULL
          AND "created_at" < ${cutoff}`;
      return suspended === 1;
    });
  }

  async deleteUnverified(accountId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "account"
        WHERE "id" = ${accountId}::uuid AND "email_verified_at" IS NULL AND "status" = 'SUSPENDED'
        FOR UPDATE`;
      if (account.length === 0) return false;
      await tx.profile.deleteMany({ where: { accountId } });
      // Jetons, identités, codes de secours, appareils : en cascade. Sessions : RESTRICT.
      await tx.account.delete({ where: { id: accountId } });
      return true;
    });
  }
}
