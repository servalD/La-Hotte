import type { AuditWrite } from '../../../shared/domain';
import type { AccountRole } from './session';

/** Compte visé par une action d'administration (ADM-06 à ADM-08, RBAC-07). Aucun contenu. */
export interface AdminTarget {
  readonly accountId: string;
  readonly email: string;
  readonly role: AccountRole;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_DELETION';
  readonly emailVerified: boolean;
  readonly totpEnabled: boolean;
  readonly underGuardianship: boolean;
  /** ADM-06 : la dernière entrée d'audit de suspension ou de réactivation est une suspension. */
  readonly suspendedByAdmin: boolean;
}

export type RoleChangeOutcome = 'changed' | 'unchanged' | 'last_admin';

/**
 * Écritures d'administration d'un compte. Chaque méthode écrit l'état **et** ses entrées
 * d'audit dans une même transaction (AUD-05) ; si l'audit échoue, rien n'est écrit.
 */
export abstract class AccountAdministration {
  abstract target(accountId: string): Promise<AdminTarget | null>;

  /** ADM-06 : `ACTIVE` → `SUSPENDED`, époque écrite. Faux si l'état a changé entre-temps. */
  abstract suspend(input: {
    readonly accountId: string;
    readonly authEpoch: number;
    readonly audit: AuditWrite;
  }): Promise<boolean>;

  /** ADM-06 : `SUSPENDED` (par l'administration) → `ACTIVE`. Faux sinon. */
  abstract reactivate(input: {
    readonly accountId: string;
    readonly audit: AuditWrite;
  }): Promise<boolean>;

  /** ADM-08 : époque écrite, rien d'autre. */
  abstract writeEpoch(input: {
    readonly accountId: string;
    readonly authEpoch: number;
    readonly audit: AuditWrite;
  }): Promise<void>;

  /**
   * RBAC-03, RBAC-07 : rôle changé et époque écrite. Retirer `ADMIN` au dernier administrateur
   * actif est refusé (`last_admin`), vérifié sous verrou dans la transaction.
   */
  abstract setRole(input: {
    readonly accountId: string;
    readonly role: AccountRole;
    readonly authEpoch: number;
    readonly audits: (before: AccountRole) => readonly AuditWrite[];
  }): Promise<RoleChangeOutcome>;

  /**
   * ADM-07 : TOTP désactivé, codes de secours effacés, appareils de confiance révoqués, époque
   * écrite. Faux si le TOTP n'était plus actif.
   */
  abstract completeTotpReset(input: {
    readonly accountId: string;
    readonly authEpoch: number;
    readonly now: Date;
    readonly audit: AuditWrite;
  }): Promise<boolean>;

  /**
   * MOD-10 : publication au catalogue global suspendue (`at`) ou rétablie (`null`) pour le compte
   * de ce profil. Rend le compte, ou `null` si le profil n'existe plus.
   */
  abstract setPublicationSuspended(input: {
    readonly profileId: string | null;
    readonly accountId: string | null;
    readonly at: Date | null;
    readonly audit: AuditWrite | null;
  }): Promise<string | null>;

  /** ADM-07 : entrée de la demande, quand aucun rôle n'est retiré (sinon `setRole` l'écrit). */
  abstract recordTotpResetRequest(audit: AuditWrite): Promise<void>;
}
