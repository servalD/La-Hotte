import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import type { AuditAction } from '../../../shared/domain';
import {
  ACTIONS_SHOWN_TO_HOLDER,
  AccountDirectory,
  type AccountMetadata,
  type AdminActionOnAccount,
  REASON_SHOWN_TO_HOLDER,
} from '../domain/account-directory';

/**
 * Lectures de l'espace d'administration (ADR 0021) : un modèle de lecture propre au module
 * `admin`, qui ne sélectionne que des dates, des nombres et des états (ADM-01, ADM-04). Aucune
 * colonne de contenu n'est lue.
 */
@Injectable()
export class PrismaAccountDirectory extends AccountDirectory {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findByEmail(email: string): Promise<AccountMetadata | null> {
    const account = await this.prisma.account.findUnique({
      where: { email },
      select: {
        id: true,
        createdAt: true,
        lastSignInAt: true,
        role: true,
        status: true,
        totpEnabledAt: true,
        emailVerifiedAt: true,
        publicationSuspendedAt: true,
        _count: { select: { profiles: true } },
      },
    });
    if (!account) return null;
    const [listCount, suspensions] = await Promise.all([
      // ADM-04 : listes de souhaits seulement ; une giftlist ne doit pas se deviner (VIS-20).
      this.prisma.list.count({ where: { type: 'WISHLIST', creator: { accountId: account.id } } }),
      this.prisma.auditLog.findMany({
        where: {
          targetId: account.id,
          action: { in: ['account.suspend', 'account.reactivate'] },
        },
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        take: 20,
        select: { action: true, at: true },
      }),
    ]);
    return {
      accountId: account.id,
      createdAt: account.createdAt,
      lastSignInAt: account.lastSignInAt,
      profileCount: account._count.profiles,
      listCount,
      role: account.role,
      status: account.status,
      totpEnabled: account.totpEnabledAt !== null,
      emailVerified: account.emailVerifiedAt !== null,
      publicationSuspended: account.publicationSuspendedAt !== null,
      suspensions: suspensions.map((row) => ({ action: row.action as AuditAction, at: row.at })),
    };
  }

  async actionsOn(accountId: string): Promise<AdminActionOnAccount[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        targetKind: 'ACCOUNT',
        targetId: accountId,
        action: { in: [...ACTIONS_SHOWN_TO_HOLDER] },
      },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: 50,
      select: { action: true, at: true, reason: true },
    });
    return rows.map((row) => {
      const action = row.action as AuditAction;
      return {
        action,
        at: row.at,
        reason: REASON_SHOWN_TO_HOLDER.has(action) ? row.reason : null,
      };
    });
  }
}
