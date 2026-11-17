import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import {
  AccountLifecycle,
  type DeletionRequestOutcome,
  type InactiveAccount,
} from '../domain/account-lifecycle';

/** RGPD-12, RGPD-13 : demandes, annulations, effacements et avertissements, sous verrou. */
@Injectable()
export class PrismaAccountLifecycle extends AccountLifecycle {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  requestDeletion(input: {
    accountId: string;
    authEpoch: number;
    at: Date;
  }): Promise<DeletionRequestOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const [account] = await tx.$queryRaw<{ status: string; role: string }[]>`
        SELECT "status", "role" FROM "account" WHERE "id" = ${input.accountId}::uuid FOR UPDATE`;
      if (!account) return 'missing';
      if (account.status === 'PENDING_DELETION') return 'already';
      if (account.status !== 'ACTIVE') return 'missing';
      const wards = await tx.account.count({ where: { guardianAccountId: input.accountId } });
      if (wards > 0) return 'has_wards';
      if (account.role === 'ADMIN') {
        const others = await tx.account.count({
          where: { role: 'ADMIN', status: 'ACTIVE', id: { not: input.accountId } },
        });
        if (others === 0) return 'last_admin';
      }
      await tx.$executeRaw`
        UPDATE "account"
        SET "status" = 'PENDING_DELETION', "deletion_requested_at" = ${input.at},
            "auth_epoch" = GREATEST("auth_epoch", ${input.authEpoch}), "updated_at" = now()
        WHERE "id" = ${input.accountId}::uuid`;
      await tx.trustedDevice.updateMany({
        where: { accountId: input.accountId, revokedAt: null },
        data: { revokedAt: input.at },
      });
      return 'requested';
    });
  }

  async deletionBlocker(accountId: string): Promise<'has_wards' | 'last_admin' | null> {
    if ((await this.prisma.account.count({ where: { guardianAccountId: accountId } })) > 0) {
      return 'has_wards';
    }
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { role: true },
    });
    if (account?.role === 'ADMIN') {
      const others = await this.prisma.account.count({
        where: { role: 'ADMIN', status: 'ACTIVE', id: { not: accountId } },
      });
      if (others === 0) return 'last_admin';
    }
    return null;
  }

  async cancelDeletion(accountId: string): Promise<boolean> {
    const count = await this.prisma.$executeRaw`
      UPDATE "account" SET "status" = 'ACTIVE', "deletion_requested_at" = NULL, "updated_at" = now()
      WHERE "id" = ${accountId}::uuid AND "status" = 'PENDING_DELETION'`;
    return count === 1;
  }

  async dueForErasure(before: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.account.findMany({
      where: { status: 'PENDING_DELETION', deletionRequestedAt: { lt: before } },
      select: { id: true },
      orderBy: { deletionRequestedAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => row.id);
  }

  erase(accountId: string, before: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const [account] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "account"
        WHERE "id" = ${accountId}::uuid AND "status" = 'PENDING_DELETION'
          AND "deletion_requested_at" < ${before}
          AND NOT EXISTS (SELECT 1 FROM "account" w WHERE w."guardian_account_id" = ${accountId}::uuid)
        FOR UPDATE`;
      if (!account) return false;
      // `session.account_id` et `profile.account_id` sont en RESTRICT (ADR 0013) : sessions et
      // profils d'abord. La suppression d'un profil vide, par ses clés étrangères, les références
      // que d'autres gardent (commentaires, parts, fiches : PRO-06, DAT-06).
      await tx.session.deleteMany({ where: { accountId } });
      await tx.profile.deleteMany({ where: { accountId } });
      await tx.account.delete({ where: { id: accountId } });
      return true;
    });
  }

  async inactive(input: {
    before: Date;
    notices: 0 | 1 | 2;
    limit: number;
  }): Promise<InactiveAccount[]> {
    return this.prisma.$queryRaw<InactiveAccount[]>`
      SELECT "id" AS "accountId", "email" FROM "account"
      WHERE "status" = 'ACTIVE' AND "role" = 'USER' AND "email_verified_at" IS NOT NULL
        AND COALESCE("last_sign_in_at", "created_at") < ${input.before}
        AND "inactivity_notices" = ${input.notices}
      ORDER BY COALESCE("last_sign_in_at", "created_at"), "id"
      LIMIT ${input.limit}`;
  }

  async markWarned(accountId: string, from: 0 | 1, before: Date): Promise<boolean> {
    const count = await this.prisma.$executeRaw`
      UPDATE "account" SET "inactivity_notices" = ${from + 1}
      WHERE "id" = ${accountId}::uuid AND "inactivity_notices" = ${from}
        AND COALESCE("last_sign_in_at", "created_at") < ${before}`;
    return count === 1;
  }

  async requestDeletionForInactivity(input: {
    accountId: string;
    before: Date;
    requestedAt: Date;
  }): Promise<boolean> {
    const count = await this.prisma.$executeRaw`
      UPDATE "account"
      SET "status" = 'PENDING_DELETION', "deletion_requested_at" = ${input.requestedAt},
          "updated_at" = now()
      WHERE "id" = ${input.accountId}::uuid AND "status" = 'ACTIVE' AND "role" = 'USER'
        AND "inactivity_notices" = 2
        AND COALESCE("last_sign_in_at", "created_at") < ${input.before}`;
    return count === 1;
  }
}
