import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { appendAudit } from '../../../platform/prisma/audit-writer';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import type { AuditWrite } from '../../../shared/domain';
import {
  AccountAdministration,
  type AdminTarget,
  type RoleChangeOutcome,
} from '../domain/account-administration';
import type { AccountRole } from '../domain/session';

type Tx = Prisma.TransactionClient;

/** ADR 0014 : l'époque ne recule jamais. */
async function writeEpoch(tx: Tx, accountId: string, authEpoch: number): Promise<void> {
  await tx.$executeRaw`
    UPDATE "account" SET "auth_epoch" = GREATEST("auth_epoch", ${authEpoch}), "updated_at" = now()
    WHERE "id" = ${accountId}::uuid`;
}

/** Écritures d'administration d'un compte, chacune avec son audit (AUD-05). */
@Injectable()
export class PrismaAccountAdministration extends AccountAdministration {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async target(accountId: string): Promise<AdminTarget | null> {
    const row = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        totpEnabledAt: true,
        guardianAccountId: true,
      },
    });
    if (!row) return null;
    const last = await this.prisma.auditLog.findFirst({
      where: { targetId: accountId, action: { in: ['account.suspend', 'account.reactivate'] } },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      select: { action: true },
    });
    return {
      accountId: row.id,
      email: row.email,
      role: row.role,
      status: row.status,
      emailVerified: row.emailVerifiedAt !== null,
      totpEnabled: row.totpEnabledAt !== null,
      underGuardianship: row.guardianAccountId !== null,
      suspendedByAdmin: last?.action === 'account.suspend',
    };
  }

  suspend(input: { accountId: string; authEpoch: number; audit: AuditWrite }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.account.updateMany({
        where: { id: input.accountId, status: 'ACTIVE' },
        data: { status: 'SUSPENDED' },
      });
      if (count !== 1) return false;
      await writeEpoch(tx, input.accountId, input.authEpoch);
      // ADM-06 : appareils de confiance révoqués ; sessions et pré-authentifications tombent avec
      // l'époque.
      await tx.trustedDevice.updateMany({
        where: { accountId: input.accountId, revokedAt: null },
        data: { revokedAt: input.audit.at },
      });
      await appendAudit(tx, input.audit);
      return true;
    });
  }

  reactivate(input: { accountId: string; audit: AuditWrite }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.auditLog.findFirst({
        where: {
          targetId: input.accountId,
          action: { in: ['account.suspend', 'account.reactivate'] },
        },
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        select: { action: true },
      });
      if (last?.action !== 'account.suspend') return false;
      const { count } = await tx.account.updateMany({
        where: { id: input.accountId, status: 'SUSPENDED' },
        data: { status: 'ACTIVE' },
      });
      if (count !== 1) return false;
      await appendAudit(tx, input.audit);
      return true;
    });
  }

  async writeEpoch(input: {
    accountId: string;
    authEpoch: number;
    audit: AuditWrite;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await writeEpoch(tx, input.accountId, input.authEpoch);
      await appendAudit(tx, input.audit);
    });
  }

  setRole(input: {
    accountId: string;
    role: AccountRole;
    authEpoch: number;
    audits: (before: AccountRole) => readonly AuditWrite[];
  }): Promise<RoleChangeOutcome> {
    return this.prisma.$transaction(async (tx) => {
      // RBAC-03 : les administrateurs actifs sont verrouillés ensemble, pour que deux retraits
      // simultanés ne laissent pas la plateforme sans administrateur.
      const admins = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "account" WHERE "role" = 'ADMIN' AND "status" = 'ACTIVE'
        ORDER BY "id" FOR UPDATE`;
      const current = await tx.$queryRaw<{ role: AccountRole }[]>`
        SELECT "role" FROM "account" WHERE "id" = ${input.accountId}::uuid FOR UPDATE`;
      const before = current[0]?.role;
      if (!before || before === input.role) return 'unchanged';
      if (before === 'ADMIN' && admins.filter((a) => a.id !== input.accountId).length === 0) {
        return 'last_admin';
      }
      await tx.account.update({ where: { id: input.accountId }, data: { role: input.role } });
      await writeEpoch(tx, input.accountId, input.authEpoch);
      for (const write of input.audits(before)) await appendAudit(tx, write);
      return 'changed';
    });
  }

  completeTotpReset(input: {
    accountId: string;
    authEpoch: number;
    now: Date;
    audit: AuditWrite;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.account.updateMany({
        where: { id: input.accountId, totpEnabledAt: { not: null } },
        data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null },
      });
      if (count !== 1) return false;
      await tx.recoveryCode.deleteMany({ where: { accountId: input.accountId } });
      await tx.trustedDevice.updateMany({
        where: { accountId: input.accountId, revokedAt: null },
        data: { revokedAt: input.now },
      });
      await writeEpoch(tx, input.accountId, input.authEpoch);
      await appendAudit(tx, input.audit);
      return true;
    });
  }

  setPublicationSuspended(input: {
    profileId: string | null;
    accountId: string | null;
    at: Date | null;
    audit: AuditWrite | null;
  }): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const accountId =
        input.accountId ??
        (input.profileId
          ? (
              await tx.profile.findUnique({
                where: { id: input.profileId },
                select: { accountId: true },
              })
            )?.accountId
          : null);
      if (!accountId) return null;
      const { count } = await tx.account.updateMany({
        where: { id: accountId },
        data: { publicationSuspendedAt: input.at },
      });
      if (count !== 1) return null;
      if (input.audit) await appendAudit(tx, input.audit);
      return accountId;
    });
  }

  async recordTotpResetRequest(audit: AuditWrite): Promise<void> {
    await appendAudit(this.prisma, audit);
  }
}
