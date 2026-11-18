import type { PrismaClient } from '@prisma/client';
import { appendAudit } from '../platform/prisma/audit-writer';

/**
 * Commande d'exploitation (RBAC-03, ADM-07, ADR 0021), lancée sur le serveur, jamais par
 * l'interface :
 *
 * - `grant <email>` : donne `ADMIN` au compte. Le premier administrateur naît ainsi.
 * - `recover <email>` : dernier recours quand un administrateur a perdu son second facteur. Retire
 *   le TOTP, les codes de secours, les appareils de confiance et le rôle, puis coupe toutes les
 *   sessions. Le titulaire se reconnecte, active un nouveau TOTP, et `grant` lui rend le rôle.
 *
 * Chaque changement écrit son entrée d'audit dans la même transaction (AUD-05), sans acteur.
 * Les messages ne citent jamais l'adresse (OBS-20).
 */
export type AdminCommand =
  | { readonly kind: 'grant'; readonly email: string }
  | { readonly kind: 'recover'; readonly email: string };

export type AdminCommandOutcome =
  'granted' | 'already_admin' | 'recovered' | 'account_not_found' | 'requirements_not_met';

/** `epoch` : époque écrite en base, à reporter dans Redis (ADR 0014) ; absente sans changement. */
export interface AdminCommandResult {
  readonly outcome: AdminCommandOutcome;
  readonly accountId?: string;
  readonly epoch?: number;
}

export function parseAdminCommand(argv: readonly string[]): AdminCommand | null {
  const [verb, rawEmail, ...rest] = argv;
  if (rest.length > 0 || !rawEmail) return null;
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254) return null;
  if (verb === 'grant') return { kind: 'grant', email };
  if (verb === 'recover') return { kind: 'recover', email };
  return null;
}

export async function runAdminCommand(
  prisma: PrismaClient,
  command: AdminCommand,
  deps: { readonly now: Date; readonly newId: () => string },
): Promise<AdminCommandResult> {
  return prisma.$transaction(async (tx) => {
    const account = await tx.account.findUnique({
      where: { email: command.email },
      select: {
        id: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        totpEnabledAt: true,
        guardianAccountId: true,
      },
    });
    if (!account) return { outcome: 'account_not_found' };

    if (command.kind === 'grant') {
      if (account.role === 'ADMIN') return { outcome: 'already_admin' };
      // RBAC-07, AUTH-13 : TOTP actif, adresse vérifiée, compte actif et autonome.
      if (
        account.status !== 'ACTIVE' ||
        !account.emailVerifiedAt ||
        !account.totpEnabledAt ||
        account.guardianAccountId
      ) {
        return { outcome: 'requirements_not_met' };
      }
      const granted = await tx.account.update({
        where: { id: account.id },
        data: { role: 'ADMIN', authEpoch: { increment: 2 } },
        select: { authEpoch: true },
      });
      await appendAudit(tx, {
        id: deps.newId(),
        at: deps.now,
        entry: {
          actorAccountId: null,
          action: 'role.grant_by_operator',
          targetKind: 'ACCOUNT',
          targetId: account.id,
          reason: 'Commande d’exploitation (RBAC-03)',
          ip: null,
          before: account.role,
          after: 'ADMIN',
        },
      });
      return { outcome: 'granted', accountId: account.id, epoch: granted.authEpoch };
    }

    await tx.recoveryCode.deleteMany({ where: { accountId: account.id } });
    await tx.trustedDevice.updateMany({
      where: { accountId: account.id, revokedAt: null },
      data: { revokedAt: deps.now },
    });
    const recovered = await tx.account.update({
      where: { id: account.id },
      data: {
        role: 'USER',
        totpSecretEnc: null,
        totpEnabledAt: null,
        totpLastStep: null,
        // ADR 0014 : l'époque coupe toutes les sessions, y compris celles en cache.
        authEpoch: { increment: 2 },
      },
      select: { authEpoch: true },
    });
    for (const [action, before, after] of [
      ['account.totp_reset_completed', null, null],
      ['role.revoke', account.role, 'USER'],
    ] as const) {
      await appendAudit(tx, {
        id: deps.newId(),
        at: deps.now,
        entry: {
          actorAccountId: null,
          action,
          targetKind: 'ACCOUNT',
          targetId: account.id,
          reason: 'Commande d’exploitation (ADM-07)',
          ip: null,
          before,
          after,
        },
      });
    }
    return { outcome: 'recovered', accountId: account.id, epoch: recovered.authEpoch };
  });
}
