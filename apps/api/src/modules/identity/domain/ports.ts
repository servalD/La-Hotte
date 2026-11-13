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
  /** Forme d'un jeton tiré par `generate` (refus rapide de toute autre valeur). */
  abstract isWellFormed(token: string): boolean;
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
  /** Échec : compté sur chaque sujet, réservation rendue. */
  abstract recordFailure(
    subjects: readonly RateLimitSubject[],
    now: Date,
    reservation: string,
  ): Promise<void>;
  /** Succès : compteurs `resetOnSuccess` vidés, réservation rendue. */
  abstract recordSuccess(subjects: readonly RateLimitSubject[], reservation: string): Promise<void>;
}

/**
 * Premier événement d'une fenêtre (journal de sécurité) : vrai une fois par clé et par fenêtre.
 * Évite qu'un anonyme remplisse une table en ajout seul (DAT-02). Sans Redis, faux : l'événement
 * n'est pas écrit, la requête reste refusée.
 */
export abstract class EventThrottle {
  abstract firstInWindow(parts: readonly string[], windowMs: number): Promise<boolean>;
}

export const SECURITY_EVENTS = ['csrf.rejected', 'session.revoked'] as const;
export type SecurityEvent = (typeof SECURITY_EVENTS)[number];

/** Journal de sécurité (SEC-30), en ajout seul (DAT-02). */
export abstract class SecurityLog {
  abstract record(entry: {
    readonly accountId: string | null;
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
    };

export type IdentityEventListener = (event: IdentityEvent) => void;

export abstract class IdentityEvents {
  abstract publish(event: IdentityEvent): void;
  /** Renvoie la fonction de désabonnement. */
  abstract subscribe(listener: IdentityEventListener): () => void;
}
