/** RGPD-12 : délai de grâce avant l'effacement. */
export const DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
/** RGPD-09, RGPD-13 : trois ans sans connexion. */
export const INACTIVITY_MS = 3 * 365 * 24 * 60 * 60 * 1000;
/** RGPD-13 : avertissements à 30 puis 7 jours de l'échéance. */
export const INACTIVITY_WARNINGS: readonly {
  readonly notices: 0 | 1;
  readonly daysLeft: number;
}[] = [
  { notices: 0, daysLeft: 30 },
  { notices: 1, daysLeft: 7 },
];
const DAY_MS = 24 * 60 * 60 * 1000;

export function inactivityThreshold(now: Date, daysLeft: number): Date {
  return new Date(now.getTime() - INACTIVITY_MS + daysLeft * DAY_MS);
}

export type DeletionRequestOutcome =
  'requested' | 'already' | 'has_wards' | 'last_admin' | 'missing';

/** Compte à avertir (RGPD-13). */
export interface InactiveAccount {
  readonly accountId: string;
  readonly email: string;
}

/**
 * Cycle de vie d'un compte (RGPD-12, RGPD-13). Chaque méthode revérifie l'état en base, sous
 * verrou : deux exécutions de la tâche planifiée ne font jamais deux fois la même chose.
 */
export abstract class AccountLifecycle {
  /**
   * RGPD-12 : `PENDING_DELETION` et époque écrite, sauf compte tuteur d'un autre ou dernier
   * administrateur actif.
   */
  abstract requestDeletion(input: {
    readonly accountId: string;
    readonly authEpoch: number;
    readonly at: Date;
  }): Promise<DeletionRequestOutcome>;

  /** RGPD-12 : ce qui empêche la demande, lu avant de couper les sessions. */
  abstract deletionBlocker(accountId: string): Promise<'has_wards' | 'last_admin' | null>;

  /** RGPD-12 : connexion réussie pendant le délai de grâce. Faux si rien n'était demandé. */
  abstract cancelDeletion(accountId: string): Promise<boolean>;

  /** RGPD-12 : comptes dont la demande est plus ancienne que `before`. */
  abstract dueForErasure(before: Date, limit: number): Promise<string[]>;

  /**
   * RGPD-12 : effacement, si le compte est toujours en attente depuis avant `before`. Sessions et
   * profils supprimés (les clés étrangères vident les références des autres, PRO-06), puis le
   * compte. Faux si l'état a changé.
   */
  abstract erase(accountId: string, before: Date): Promise<boolean>;

  /**
   * RGPD-13 : comptes actifs, vérifiés, sans rôle de plateforme, sans connexion depuis `before`
   * (à défaut, depuis leur création), qui ont reçu `notices` avertissements.
   */
  abstract inactive(input: {
    readonly before: Date;
    readonly notices: 0 | 1 | 2;
    readonly limit: number;
  }): Promise<InactiveAccount[]>;

  /** RGPD-13 : avertissement envoyé ; faux si le compte s'est connecté entre-temps. */
  abstract markWarned(accountId: string, from: 0 | 1, before: Date): Promise<boolean>;

  /**
   * RGPD-13 : demande d'effacement sans délai de grâce de plus (`requestedAt` antidaté), si le
   * compte est toujours inactif et averti deux fois.
   */
  abstract requestDeletionForInactivity(input: {
    readonly accountId: string;
    readonly before: Date;
    readonly requestedAt: Date;
  }): Promise<boolean>;
}
