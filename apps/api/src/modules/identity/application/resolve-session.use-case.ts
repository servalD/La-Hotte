import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { SecretTokens, type SessionRef, SessionStore } from '../domain/ports';
import {
  type CachedSession,
  PERSIST_INTERVAL_MS,
  rejectSession,
  type SessionRecord,
  slideExpiry,
  type Unlock,
} from '../domain/session';
import { SessionLifecycle } from './session-lifecycle';

/** Session reconnue pour la requête en cours. */
export interface ResolvedSession {
  readonly record: SessionRecord;
  readonly unlock: Unlock | null;
}

export function sessionRef(record: SessionRecord): SessionRef {
  return { id: record.id, accountId: record.accountId, tokenHash: record.tokenHash };
}

/**
 * Lecture de session à chaque requête (ADR 0013, « Stockage ») : cache puis base, époque du
 * compte, durées glissante et absolue, réhydratation atomique (profil verrouillé), expiration
 * glissante. Une session refusée pour époque ou durée est révoquée.
 */
@Injectable()
export class ResolveSession {
  constructor(
    private readonly store: SessionStore,
    private readonly tokens: SecretTokens,
    private readonly lifecycle: SessionLifecycle,
    private readonly clock: Clock,
  ) {}

  async execute(token: string | null): Promise<ResolvedSession | null> {
    if (!token || !this.tokens.isWellFormed(token)) return null;
    const tokenHash = this.tokens.hash(token);
    const now = this.clock.now();
    const found = await this.store.lookup(tokenHash);

    let session: CachedSession;
    switch (found.kind) {
      case 'revoked':
      case 'absent':
        return null;
      case 'cached': {
        if (rejectSession(found.session.record, found.accountEpoch, now)) {
          await this.lifecycle.revoke(sessionRef(found.session.record));
          return null;
        }
        session = found.session;
        break;
      }
      case 'stored': {
        // Rôle courant du compte : les durées suivent le compte, pas une copie ancienne.
        const record: SessionRecord = { ...found.record, role: found.account.role };
        if (!found.account.active || rejectSession(record, found.account.epoch, now)) {
          await this.lifecycle.revoke(sessionRef(record));
          return null;
        }
        // Une marque posée entre la lecture et l'écriture du cache l'emporte (script atomique).
        if (!(await this.store.rehydrate(record, now))) return null;
        // Réhydratée : profil actif conservé, mais verrouillé (pas de déverrouillage).
        session = { record, unlock: null, persistedAt: now };
        break;
      }
    }

    return this.slide(session, now);
  }

  private async slide(session: CachedSession, now: Date): Promise<ResolvedSession | null> {
    const expiresAt = slideExpiry(session.record, now);
    const persist = now.getTime() - session.persistedAt.getTime() >= PERSIST_INTERVAL_MS;
    const ttlMs = expiresAt.getTime() - now.getTime();
    const patched = await this.store.patchCache(
      session.record.tokenHash,
      { lastSeenAt: now, expiresAt, ...(persist ? { persistedAt: now } : {}) },
      ttlMs,
    );
    // Révoquée entre la lecture et l'écriture : refus.
    if (!patched) return null;
    if (persist) {
      // Toutes les 5 minutes, le cache est confronté à la base (ligne, époque, compte actif).
      const alive = await this.store.persistActivity(
        sessionRef(session.record),
        session.record.authEpoch,
        now,
        expiresAt,
      );
      if (!alive) {
        // Seulement ce jeton : si une rotation l'a remplacé entre-temps, la session tournée vit.
        await this.lifecycle.revokeToken(sessionRef(session.record));
        return null;
      }
    }
    return {
      record: { ...session.record, lastSeenAt: now, expiresAt },
      unlock: session.unlock,
    };
  }
}
