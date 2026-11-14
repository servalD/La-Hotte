import type { RateLimitSubject } from './rate-limit';
import type {
  AccountRole,
  CachedSession,
  ProfileLockPolicy,
  SessionRecord,
  Unlock,
} from './session';

/** Identifiants d'une session, pour la révoquer. */
export interface SessionRef {
  readonly id: string;
  readonly accountId: string;
  readonly tokenHash: string;
}

/** État d'authentification d'un compte. */
export interface AccountAuthState {
  readonly accountId: string;
  readonly role: AccountRole;
  readonly active: boolean;
  /** Époque courante : la plus grande de PostgreSQL et de Redis (ADR 0013). */
  readonly epoch: number;
}

export type SessionLookup =
  | { readonly kind: 'revoked' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'cached'; readonly session: CachedSession; readonly accountEpoch: number }
  | {
      readonly kind: 'stored';
      readonly record: SessionRecord;
      readonly account: AccountAuthState;
    };

/** Modification du cache d'une session ; sans effet si elle est absente ou révoquée. */
export interface SessionCachePatch {
  readonly lastSeenAt?: Date;
  readonly expiresAt?: Date;
  readonly persistedAt?: Date;
  readonly activeProfileId?: string | null;
  readonly reauthAt?: Date | null;
  /** `null` efface le déverrouillage. */
  readonly unlock?: Unlock | null;
}

/**
 * Sessions : PostgreSQL source de vérité, Redis cache (ADR 0013). Toute panne du stockage lève
 * `IdentityUnavailableError` : jamais d'ouverture par défaut.
 */
export abstract class SessionStore {
  /** Écrit la ligne, puis le cache. */
  abstract insert(record: SessionRecord, now: Date): Promise<void>;

  /** `MGET` cache et marque, puis époque du compte ; à défaut de cache, la ligne en base. */
  abstract lookup(tokenHash: string): Promise<SessionLookup>;

  /** Réécrit le cache depuis la base, atomiquement, seulement sans marque de révocation. */
  abstract rehydrate(record: SessionRecord, now: Date): Promise<boolean>;

  /** Modifie le cache (et sa durée de vie) ; faux si la session est absente ou révoquée. */
  abstract patchCache(
    tokenHash: string,
    patch: SessionCachePatch,
    ttlMs?: number,
  ): Promise<boolean>;

  /**
   * Prolonge le déverrouillage s'il est toujours exactement `expected` (compare-and-set) ; faux
   * si un verrouillage ou un changement de profil est passé entre-temps (PIN-07).
   */
  abstract touchUnlock(tokenHash: string, expected: Unlock, at: Date): Promise<boolean>;

  /**
   * Recopie `last_seen_at` et `expires_at` en base, si la ligne existe encore sous ce hash, que le
   * compte est actif et que l'époque est la même. Faux sinon : la session doit être refusée.
   */
  abstract persistActivity(
    ref: SessionRef,
    authEpoch: number,
    lastSeenAt: Date,
    expiresAt: Date,
  ): Promise<boolean>;

  /**
   * Révocation (ADR 0013) par `id`, quel que soit le hash courant : marques de 90 jours, puis
   * suppression de la ligne, puis du cache. Sans marque posée, rien n'est supprimé.
   */
  abstract revoke(ref: SessionRef): Promise<void>;

  /**
   * Révocation de ce seul jeton : marque sur `ref.tokenHash`, ligne supprimée seulement si elle a
   * encore ce hash. Vrai si une ligne a été supprimée. Sert quand le refus vient du jeton lu
   * (recopie impossible) et qu'une rotation a pu le remplacer entre-temps.
   */
  abstract revokeToken(ref: SessionRef): Promise<boolean>;

  /** Révoque toutes les sessions du compte, à partir des lignes de PostgreSQL. */
  abstract revokeAllForAccount(accountId: string, exceptSessionId?: string): Promise<SessionRef[]>;

  /**
   * Référence d'une session lue par `id` **et** `account_id` (AUTH-05) : seul moyen de révoquer
   * une session désignée par le client. `null` si elle n'existe pas ou est d'un autre compte.
   */
  abstract findOwned(accountId: string, sessionId: string): Promise<SessionRef | null>;

  /** Sessions du compte, depuis PostgreSQL (AUTH-05). */
  abstract listForAccount(accountId: string): Promise<SessionRecord[]>;

  /**
   * Rotation (ré-authentification) : même `id`, nouveau jeton, ancien jeton révoqué. Faux si la
   * session a été révoquée entre-temps.
   */
  abstract rotateToken(ref: SessionRef, newTokenHash: string, reauthAt: Date): Promise<boolean>;

  /** Profil actif changé : déverrouillage et ré-authentification effacés (PIN-07, ADR 0013). */
  abstract setActiveProfile(ref: SessionRef, profileId: string | null): Promise<void>;

  /** Verrouillage : déverrouillage et ré-authentification effacés. */
  abstract lock(ref: SessionRef): Promise<void>;

  /** Session par identifiant (passerelle temps réel). Cache absent : déverrouillage `null`. */
  abstract findById(
    sessionId: string,
  ): Promise<{ record: SessionRecord; unlock: Unlock | null; accountEpoch: number } | null>;

  /** État du compte ; répare l'époque vers l'avant si Redis et PostgreSQL divergent. */
  abstract accountState(accountId: string): Promise<AccountAuthState | null>;

  /**
   * ADR 0014 : porte l'époque de Redis à E+1 (ce qui déconnecte tout de suite) et renvoie E+2,
   * que l'appelant écrit en base dans sa transaction, puis passe à `completeEpochChange`.
   */
  abstract beginEpochChange(accountId: string): Promise<number>;

  /** Après la validation de la transaction : Redis porté à l'époque écrite (jamais en arrière). */
  abstract completeEpochChange(accountId: string, epoch: number): Promise<void>;
}

/** Jetons opaques : tirage (256 bits) et hachage SHA-256. */
export abstract class SecretTokens {
  /** Jeton de 32 octets, base64url. */
  abstract generate(): string;
  /** SHA-256 en hexadécimal. */
  abstract hash(token: string): string;
  /** AUTH-10 : code de secours de 80 bits, 16 caractères de Crockford (non formaté). */
  abstract generateRecoveryCode(): string;
  /** Forme d'un jeton tiré par `generate` (refus rapide de toute autre valeur). */
  abstract isWellFormed(token: string): boolean;
  /** LNK-01 : jeton d'invitation de 128 bits, 22 caractères base64url. */
  abstract generateInvitation(): string;
}

/** Jeton CSRF à double soumission signée (ADR 0013, « CSRF »). */
export abstract class CsrfTokens {
  abstract forSession(tokenHash: string): string;
  abstract forPresession(presessionId: string): string;
  /** Comparaison en temps constant. */
  abstract matches(expected: string, received: string): boolean;
}

/** Réglage de verrouillage d'un profil du compte ; `null` si absent ou d'un autre compte. */
export abstract class ProfileLockPolicies {
  abstract find(accountId: string, profileId: string): Promise<ProfileLockPolicy | null>;
}

export interface RateLimitCheck {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
  /**
   * Réservation de l'essai autorisé, à rendre par `recordFailure` ou `recordSuccess`. `null` si
   * l'essai est refusé.
   */
  readonly reservation: string | null;
}

/**
 * Compteurs d'échecs (AUTH-07). Un essai autorisé est **réservé** jusqu'à son issue : sous le
 * seuil, échecs et essais en cours ne dépassent jamais le seuil ensemble ; au-delà, un seul essai
 * à la fois, après le délai. Une rafale parallèle n'est donc pas évaluée avant d'être comptée.
 * Panne de Redis : `IdentityUnavailableError`.
 */
export abstract class RateLimiter {
  abstract check(subjects: readonly RateLimitSubject[], now: Date): Promise<RateLimitCheck>;
  /**
   * Échec : compté sur chaque sujet, réservation rendue. Renvoie, pour chaque sujet dans l'ordre,
   * le nombre d'échecs dans la fenêtre, celui-ci compris (alerte au franchissement du seuil).
   */
  abstract recordFailure(
    subjects: readonly RateLimitSubject[],
    now: Date,
    reservation: string,
  ): Promise<readonly number[]>;
  /** Succès : compteurs `resetOnSuccess` vidés, réservation rendue. */
  abstract recordSuccess(subjects: readonly RateLimitSubject[], reservation: string): Promise<void>;
  /**
   * Compteurs vidés hors de tout essai, par une preuve plus forte que le facteur compté (lien de
   * réinitialisation reçu par e-mail). Les réservations en cours ne sont pas touchées.
   */
  abstract clear(subjects: readonly RateLimitSubject[]): Promise<void>;
}

/**
 * Premier événement d'une fenêtre (journal de sécurité) : vrai une fois par clé et par fenêtre.
 * Évite qu'un anonyme remplisse une table en ajout seul (DAT-02). Sans Redis, faux : l'événement
 * n'est pas écrit, la requête reste refusée.
 */
export abstract class EventThrottle {
  abstract firstInWindow(parts: readonly string[], windowMs: number): Promise<boolean>;
}

/** SEC-30. Forme vérifiée en base (`security_log_event_format`). */
export const SECURITY_EVENTS = [
  'csrf.rejected',
  'session.revoked',
  'account.registered',
  'account.purged',
  'login.succeeded',
  'login.failed',
  'reauth.succeeded',
  'reauth.failed',
  'password.changed',
  'password.reset',
  'email.verified',
  'email.change_requested',
  'email.changed',
  'email.change_cancelled',
  'login.second_factor_required',
  'totp.failed',
  'totp.enrollment_started',
  'totp.enabled',
  'totp.disabled',
  'recovery.code_used',
  'recovery.codes_regenerated',
  'device.trusted',
  'device.revoked',
  'google.rejected',
  'google.linked',
  'google.unlinked',
  'account.replaced',
  // PIN-03 à PIN-05, PRO-08.
  'pin.locked',
  'pin.changed',
  'pin.reset',
  'pin.disabled',
  'profile.created',
  'profile.deleted',
  'profile.child_changed',
  'invitation.created',
  'invitation.revoked',
  'link.created',
  'link.approved',
  'link.deleted',
  'block.created',
  'block.removed',
  // PRO-15, PRO-16 : écrits au journal des deux comptes, tuteur et sous tutelle.
  'ward.setup_requested',
  'ward.created',
  'ward.sessions_revoked',
  'ward.password_reset',
  'ward.profile_created',
  'ward.release_requested',
  'ward.released',
  // PRO-11.
  'profile_invitation.created',
  'profile_invitation.redeemed',
  'profile_proposal.accepted',
  'profile_proposal.refused',
  // PRO-12 à PRO-14.
  'profile.transfer_requested',
  'profile.transfer_consented',
  'profile.transfer_completed',
  'profile.transfer_cancelled',
] as const;
export type SecurityEvent = (typeof SECURITY_EVENTS)[number];

/** Journal de sécurité (SEC-30), en ajout seul (DAT-02). */
export abstract class SecurityLog {
  abstract record(entry: {
    readonly accountId: string | null;
    /** PRO-14, PRO-16 : profil et demande concernés, sans clé étrangère. */
    readonly profileId?: string | null;
    readonly transferId?: string | null;
    readonly event: SecurityEvent;
    readonly ip: string;
    readonly userAgent: string;
    readonly at: Date;
  }): Promise<void>;
}

/** E-mail en texte brut : aucun contenu d'utilisateur n'est rendu en HTML (invariant 6). */
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export abstract class MailSender {
  abstract send(message: MailMessage): Promise<void>;
}

/** Événements internes du module (ADR 0013, « Révocation »). */
export type IdentityEvent =
  | { readonly type: 'session.revoked'; readonly sessionId: string; readonly accountId: string }
  | {
      readonly type: 'profile.locked';
      readonly sessionId: string;
      readonly profileId: string;
    }
  | {
      readonly type: 'session.profile_changed';
      readonly sessionId: string;
      readonly profileId: string | null;
    }
  /**
   * LNK-09 : le cercle de ces profils a changé (lien accepté, rompu, blocage). La passerelle
   * temps réel (phase 4, RT-07) désabonne et purge le cache local.
   */
  | { readonly type: 'circle.changed'; readonly profileIds: readonly string[] };

export type IdentityEventListener = (event: IdentityEvent) => void;

export abstract class IdentityEvents {
  abstract publish(event: IdentityEvent): void;
  /** Renvoie la fonction de désabonnement. */
  abstract subscribe(listener: IdentityEventListener): () => void;
}
