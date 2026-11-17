import type { AuditAction } from '../../../shared/domain';

/**
 * ADM-04 : ce qu'un administrateur voit d'un compte, et rien d'autre. Ni adresse, ni nom de
 * profil, ni titre : des dates, des nombres et des états.
 */
export interface AccountMetadata {
  readonly accountId: string;
  readonly createdAt: Date;
  readonly lastSignInAt: Date | null;
  readonly profileCount: number;
  readonly listCount: number;
  readonly role: 'USER' | 'MODERATOR' | 'ADMIN';
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_DELETION';
  readonly totpEnabled: boolean;
  readonly emailVerified: boolean;
  readonly publicationSuspended: boolean;
  /** Historique de suspension (ADM-04) : action et date, du plus récent au plus ancien. */
  readonly suspensions: readonly { readonly action: AuditAction; readonly at: Date }[];
}

/** AUD-07 : action d'administration visible du titulaire, sans acteur ni adresse IP. */
export interface AdminActionOnAccount {
  readonly action: AuditAction;
  readonly at: Date;
  /** Motif d'une suspension ou d'une réinitialisation seulement. */
  readonly reason: string | null;
}

/** Actions qu'AUD-07 montre au titulaire ; une recherche n'est pas une action sur son compte. */
export const ACTIONS_SHOWN_TO_HOLDER = [
  'account.suspend',
  'account.reactivate',
  'account.force_logout',
  'account.totp_reset_requested',
  'account.totp_reset_completed',
  'role.grant',
  'role.revoke',
  'role.grant_by_operator',
] as const satisfies readonly AuditAction[];

/** Le motif n'est rendu au titulaire que pour ces actions (AUD-07). */
export const REASON_SHOWN_TO_HOLDER: ReadonlySet<AuditAction> = new Set([
  'account.suspend',
  'account.totp_reset_requested',
]);

/** Lectures de l'espace d'administration sur les comptes (ADM-04, ADM-10, AUD-07). */
export abstract class AccountDirectory {
  /** ADM-10 : adresse exacte, déjà normalisée. */
  abstract findByEmail(email: string): Promise<AccountMetadata | null>;
  /** AUD-07 : 50 dernières actions, du plus récent au plus ancien. */
  abstract actionsOn(accountId: string): Promise<AdminActionOnAccount[]>;
}

/** ADM-10 : 20 recherches par heure et par administrateur. */
export const ACCOUNT_SEARCHES_PER_HOUR = 20;

export abstract class AccountSearchQuota {
  /** Vrai si la recherche est permise, et la compte ; faux au-delà du plafond. */
  abstract take(actorAccountId: string, now: Date): Promise<boolean>;
}
