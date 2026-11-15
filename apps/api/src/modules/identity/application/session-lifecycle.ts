import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import {
  type AccountAuthState,
  IdentityEvents,
  SecretTokens,
  type SessionRef,
  SessionStore,
} from '../domain/ports';
import { GoogleReauthProofs } from '../domain/google.ports';
import { ProfileRepository } from '../domain/profile.ports';
import { newSessionExpiry, type SessionRecord } from '../domain/session';
import { SessionRequiredError } from '../domain/session.errors';

const USER_AGENT_MAX = 512;

function sessionRefOf(record: SessionRecord): SessionRef {
  return { id: record.id, accountId: record.accountId, tokenHash: record.tokenHash };
}

export interface IssuedSession {
  /** Jeton à poser dans le cookie ; jamais stocké ni journalisé. */
  readonly token: string;
  readonly record: SessionRecord;
}

/**
 * Cycle de vie des sessions (ADR 0013) : création, rotation, révocation, profil actif,
 * verrouillage. Chaque révocation, verrouillage et changement de profil publie son événement
 * interne. Sert aux cas d'usage d'authentification des tranches suivantes.
 */
@Injectable()
export class SessionLifecycle {
  constructor(
    private readonly store: SessionStore,
    private readonly tokens: SecretTokens,
    private readonly events: IdentityEvents,
    private readonly googleProofs: GoogleReauthProofs,
    private readonly profiles: ProfileRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /**
   * ADR 0014 : époque du compte à lire **avant** de vérifier le moindre identifiant, et à passer
   * à `create`. `null` si le compte n'existe pas.
   */
  async observeEpoch(accountId: string): Promise<number | null> {
    return (await this.store.accountState(accountId))?.epoch ?? null;
  }

  /** Comme `observeEpoch`, avec le rôle et le statut (AUTH-13). */
  async observe(accountId: string): Promise<AccountAuthState | null> {
    return this.store.accountState(accountId);
  }

  /**
   * Nouvelle session (connexion). Refusée si l'époque a changé depuis `observedEpoch` : une
   * vérification faite contre un ancien secret ne crée rien (ADR 0014). Si le navigateur avait
   * déjà une session, elle est révoquée côté serveur, pas seulement écrasée dans le cookie
   * (rotation, ADR 0013).
   */
  async create(input: {
    accountId: string;
    observedEpoch: number;
    userAgent: string;
    trustedDeviceId?: string | null;
    previous?: SessionRef | null;
  }): Promise<IssuedSession> {
    const account = await this.store.accountState(input.accountId);
    if (!account?.active || account.epoch !== input.observedEpoch) {
      throw new SessionRequiredError();
    }
    if (input.previous) await this.revoke(input.previous);
    // PRO-04 : un profil unique est sélectionné d'office, quel que soit le moyen de connexion. Il
    // reste verrouillé s'il a un PIN (le déverrouillage ne vit que dans le cache, jamais ici).
    const profileIds = await this.profiles.listIds(account.accountId);
    const soleProfileId = profileIds.length === 1 ? (profileIds[0] ?? null) : null;

    const now = this.clock.now();
    const token = this.tokens.generate();
    const record: SessionRecord = {
      id: this.ids.next(),
      accountId: account.accountId,
      role: account.role,
      tokenHash: this.tokens.hash(token),
      authEpoch: account.epoch,
      activeProfileId: soleProfileId,
      reauthAt: null,
      trustedDeviceId: input.trustedDeviceId ?? null,
      userAgent: input.userAgent.slice(0, USER_AGENT_MAX),
      lastSeenAt: now,
      createdAt: now,
      ...newSessionExpiry(account.role, now),
    };
    await this.store.insert(record, now);
    return { token, record };
  }

  /** Ré-authentification : même `id`, nouveau jeton, ancien jeton révoqué. */
  async rotate(ref: SessionRef): Promise<IssuedSession> {
    const token = this.tokens.generate();
    const tokenHash = this.tokens.hash(token);
    const now = this.clock.now();
    const rotated = await this.store.rotateToken(ref, tokenHash, now);
    if (!rotated) throw new SessionRequiredError();
    const found = await this.store.findById(ref.id);
    if (!found) throw new SessionRequiredError();
    return { token, record: found.record };
  }

  async revoke(ref: SessionRef): Promise<void> {
    await this.store.revoke(ref);
    this.events.publish({ type: 'session.revoked', sessionId: ref.id, accountId: ref.accountId });
  }

  /** Ce seul jeton ; l'événement n'est publié que si la session elle-même disparaît. */
  async revokeToken(ref: SessionRef): Promise<void> {
    if (await this.store.revokeToken(ref)) {
      this.events.publish({ type: 'session.revoked', sessionId: ref.id, accountId: ref.accountId });
    }
  }

  /** AUTH-05 : à partir des lignes de PostgreSQL, jamais de l'ensemble Redis. */
  async revokeAll(accountId: string, exceptSessionId?: string): Promise<void> {
    const revoked = await this.store.revokeAllForAccount(accountId, exceptSessionId);
    for (const ref of revoked) {
      this.events.publish({ type: 'session.revoked', sessionId: ref.id, accountId });
    }
  }

  /**
   * AUTH-05 : session désignée par le client. Le hash est lu par `id` **et** `account_id` avant
   * toute marque : une session d'un autre compte n'est jamais touchée. `null` si introuvable.
   */
  async revokeOwned(accountId: string, sessionId: string): Promise<SessionRef | null> {
    const ref = await this.store.findOwned(accountId, sessionId);
    if (!ref) return null;
    await this.revoke(ref);
    return ref;
  }

  async list(accountId: string): Promise<SessionRecord[]> {
    return this.store.listForAccount(accountId);
  }

  /**
   * Événement qui doit tout révoquer (ADR 0013, ADR 0014) : époque portée à E+1 dans Redis
   * (tout est refusé tout de suite), `apply(E+2)` écrit l'époque et le changement dans sa
   * transaction, Redis est porté à E+2, puis les lignes de session sont révoquées (nettoyage).
   * Renvoie l'époque écrite, à passer à `create` pour une session ouverte ensuite.
   */
  async changeEpoch(accountId: string, apply: (epoch: number) => Promise<void>): Promise<number> {
    const epoch = await this.store.beginEpochChange(accountId);
    await apply(epoch);
    await this.store.completeEpochChange(accountId, epoch);
    await this.revokeAll(accountId);
    return epoch;
  }

  /**
   * PIN-07 : changer de profil reverrouille et efface la ré-authentification, y compris un
   * passage par Google qui attendait son code (AUTH-14).
   */
  async selectProfile(ref: SessionRef, profileId: string | null): Promise<void> {
    // Preuve effacée d'abord : une panne fait échouer l'action avant toute écriture, jamais
    // après le changement sans son événement (salons temps réel, VIS-20).
    await this.googleProofs.consume(ref.id);
    await this.store.setActiveProfile(ref, profileId);
    this.events.publish({ type: 'session.profile_changed', sessionId: ref.id, profileId });
  }

  async lock(ref: SessionRef, profileId: string | null): Promise<void> {
    await this.googleProofs.consume(ref.id);
    await this.store.lock(ref);
    if (profileId) this.events.publish({ type: 'profile.locked', sessionId: ref.id, profileId });
  }

  /**
   * PIN-02 : déverrouillage du profil, après un PIN juste (ou la création du PIN, PIN-04). Tenu
   * dans le cache seulement (ADR 0013). `nonce` : `EVERY_OPEN`, comparé au cookie
   * `__Host-lh_unlock`. Un changement de profil concurrent l'emporte : le déverrouillage porte le
   * profil, et ne vaut que pour lui. `pinStamp` : empreinte du PIN qui l'a donné ; un PIN changé
   * ou réinitialisé entre-temps le rend sans effet (PIN-05). Faux si la session a disparu du cache.
   */
  async unlock(
    ref: SessionRef,
    profileId: string,
    nonce: string | null,
    pinStamp: string,
  ): Promise<boolean> {
    return this.store.patchCache(ref.tokenHash, {
      unlock: { profileId, at: this.clock.now(), nonce, pinStamp },
    });
  }

  /**
   * PIN-04, PIN-05 : verrouille le profil dans toutes les sessions du compte où il est actif
   * (lignes de PostgreSQL), sauf `exceptSessionId`.
   */
  async lockProfileEverywhere(
    accountId: string,
    profileId: string,
    exceptSessionId: string | null,
  ): Promise<void> {
    for (const record of await this.store.listForAccount(accountId)) {
      if (record.activeProfileId !== profileId || record.id === exceptSessionId) continue;
      await this.lock(sessionRefOf(record), profileId);
    }
  }

  /**
   * PRO-08, étape 1 : sessions où le profil est actif, lues **avant** sa suppression (la clé
   * étrangère `SET NULL` les rendrait introuvables ensuite).
   */
  async sessionsWithProfile(accountId: string, profileId: string): Promise<SessionRef[]> {
    return (await this.store.listForAccount(accountId))
      .filter((record) => record.activeProfileId === profileId)
      .map(sessionRefOf);
  }

  /**
   * PRO-08, étape 2, après la suppression : ces sessions reviennent à la sélection (cache,
   * déverrouillage et ré-authentification effacés, événement publié).
   */
  async deselect(refs: readonly SessionRef[]): Promise<void> {
    for (const ref of refs) await this.selectProfile(ref, null);
  }
}
