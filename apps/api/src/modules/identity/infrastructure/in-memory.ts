/* eslint-disable @typescript-eslint/require-await -- doubles synchrones derrière des ports asynchrones */
// Doubles en mémoire des ports du module, pour les tests de cas d'usage et de contrat. Ils
// reproduisent la sémantique des adaptateurs réels : cache et lignes séparés, marques de
// révocation, époque, réhydratation verrouillée.
import {
  type AccountAuthState,
  EventThrottle,
  type MailMessage,
  MailSender,
  ProfileLockPolicies,
  type RateLimitCheck,
  RateLimiter,
  SecurityLog,
  type SessionCachePatch,
  type SessionLookup,
  type SessionRef,
  SessionStore,
} from '../domain/ports';
import { RATE_LIMIT_POLICIES, rateLimitDelayMs, type RateLimitSubject } from '../domain/rate-limit';
import type {
  AccountRole,
  CachedSession,
  ProfileLockPolicy,
  SessionRecord,
  Unlock,
} from '../domain/session';

interface MemoryAccount {
  role: AccountRole;
  active: boolean;
  epoch: number;
}

export class InMemorySessionStore extends SessionStore {
  readonly accounts = new Map<string, MemoryAccount>();
  /** Lignes « PostgreSQL », par identifiant. */
  readonly rows = new Map<string, SessionRecord>();
  /** Cache « Redis », par hash de jeton. */
  readonly cache = new Map<string, CachedSession>();
  readonly revokedMarks = new Set<string>();
  readonly cachedEpochs = new Map<string, number>();

  addAccount(accountId: string, role: AccountRole = 'USER'): void {
    this.accounts.set(accountId, { role, active: true, epoch: 0 });
  }

  /** Simule la perte du cache (redémarrage de Redis, éviction). */
  dropCache(): void {
    this.cache.clear();
  }

  async insert(record: SessionRecord, now: Date): Promise<void> {
    this.rows.set(record.id, record);
    this.cache.set(record.tokenHash, { record, unlock: null, persistedAt: now });
  }

  async lookup(tokenHash: string): Promise<SessionLookup> {
    if (this.revokedMarks.has(tokenHash)) return { kind: 'revoked' };
    const cached = this.cache.get(tokenHash);
    if (cached) {
      const state = await this.accountState(cached.record.accountId);
      return { kind: 'cached', session: cached, accountEpoch: state?.epoch ?? -1 };
    }
    const row = [...this.rows.values()].find((r) => r.tokenHash === tokenHash);
    if (!row) return { kind: 'absent' };
    const account = await this.accountState(row.accountId);
    if (!account) return { kind: 'absent' };
    return { kind: 'stored', record: row, account };
  }

  async rehydrate(record: SessionRecord, now: Date): Promise<boolean> {
    if (this.revokedMarks.has(record.tokenHash)) return false;
    if (!this.cache.has(record.tokenHash)) {
      this.cache.set(record.tokenHash, { record, unlock: null, persistedAt: now });
    }
    return true;
  }

  async patchCache(tokenHash: string, patch: SessionCachePatch): Promise<boolean> {
    const cached = this.cache.get(tokenHash);
    if (!cached || this.revokedMarks.has(tokenHash)) return false;
    const { unlock, persistedAt, ...fields } = patch;
    this.cache.set(tokenHash, {
      record: { ...cached.record, ...fields },
      unlock: unlock === undefined ? cached.unlock : unlock,
      persistedAt: persistedAt ?? cached.persistedAt,
    });
    return true;
  }

  async touchUnlock(tokenHash: string, expected: Unlock, at: Date): Promise<boolean> {
    const cached = this.cache.get(tokenHash);
    const current = cached?.unlock;
    if (
      !cached ||
      !current ||
      this.revokedMarks.has(tokenHash) ||
      current.profileId !== expected.profileId ||
      current.at.getTime() !== expected.at.getTime() ||
      current.nonce !== expected.nonce
    ) {
      return false;
    }
    this.cache.set(tokenHash, { ...cached, unlock: { ...current, at } });
    return true;
  }

  async persistActivity(
    ref: SessionRef,
    authEpoch: number,
    lastSeenAt: Date,
    expiresAt: Date,
  ): Promise<boolean> {
    const row = this.rows.get(ref.id);
    const account = this.accounts.get(ref.accountId);
    if (
      row?.tokenHash !== ref.tokenHash ||
      row.authEpoch !== authEpoch ||
      !account?.active ||
      account.epoch !== authEpoch
    ) {
      return false;
    }
    this.rows.set(ref.id, { ...row, lastSeenAt, expiresAt });
    return true;
  }

  async revokeToken(ref: SessionRef): Promise<boolean> {
    this.revokedMarks.add(ref.tokenHash);
    this.cache.delete(ref.tokenHash);
    const row = this.rows.get(ref.id);
    if (row?.tokenHash !== ref.tokenHash || row.accountId !== ref.accountId) return false;
    this.rows.delete(ref.id);
    return true;
  }

  async revoke(ref: SessionRef): Promise<void> {
    this.revokedMarks.add(ref.tokenHash);
    this.cache.delete(ref.tokenHash);
    if (this.rows.get(ref.id)?.accountId !== ref.accountId) return;
    const current = this.rows.get(ref.id)?.tokenHash;
    for (const hash of [ref.tokenHash, ...(current ? [current] : [])]) {
      this.revokedMarks.add(hash);
      this.cache.delete(hash);
    }
    this.rows.delete(ref.id);
  }

  async revokeAllForAccount(accountId: string, exceptSessionId?: string): Promise<SessionRef[]> {
    const refs = [...this.rows.values()]
      .filter((row) => row.accountId === accountId && row.id !== exceptSessionId)
      .map((row) => ({ id: row.id, accountId, tokenHash: row.tokenHash }));
    for (const ref of refs) await this.revoke(ref);
    return refs;
  }

  async rotateToken(ref: SessionRef, newTokenHash: string, reauthAt: Date): Promise<boolean> {
    this.revokedMarks.add(ref.tokenHash);
    this.cache.delete(ref.tokenHash);
    const row = this.rows.get(ref.id);
    if (row?.tokenHash !== ref.tokenHash) return false;
    const rotated = { ...row, tokenHash: newTokenHash, reauthAt };
    this.rows.set(ref.id, rotated);
    this.cache.set(newTokenHash, { record: rotated, unlock: null, persistedAt: reauthAt });
    return true;
  }

  async setActiveProfile(ref: SessionRef, profileId: string | null): Promise<void> {
    const row = this.rows.get(ref.id);
    if (row?.tokenHash === ref.tokenHash) {
      this.rows.set(ref.id, { ...row, activeProfileId: profileId, reauthAt: null });
    }
    await this.patchCache(ref.tokenHash, {
      activeProfileId: profileId,
      reauthAt: null,
      unlock: null,
    });
  }

  async lock(ref: SessionRef): Promise<void> {
    await this.patchCache(ref.tokenHash, { unlock: null, reauthAt: null });
    const row = this.rows.get(ref.id);
    if (row?.tokenHash === ref.tokenHash) this.rows.set(ref.id, { ...row, reauthAt: null });
  }

  async findById(
    sessionId: string,
  ): Promise<{ record: SessionRecord; unlock: Unlock | null; accountEpoch: number } | null> {
    const row = this.rows.get(sessionId);
    if (!row || this.revokedMarks.has(row.tokenHash)) return null;
    const account = await this.accountState(row.accountId);
    if (!account?.active) return null;
    const unlock = this.cache.get(row.tokenHash)?.unlock ?? null;
    return { record: row, unlock, accountEpoch: account.epoch };
  }

  async accountState(accountId: string): Promise<AccountAuthState | null> {
    const account = this.accounts.get(accountId);
    if (!account) return null;
    const epoch = Math.max(account.epoch, this.cachedEpochs.get(accountId) ?? -1);
    account.epoch = epoch;
    this.cachedEpochs.set(accountId, epoch);
    return { accountId, role: account.role, active: account.active, epoch };
  }

  async beginEpochChange(accountId: string): Promise<number> {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error('Compte introuvable');
    const next = Math.max(account.epoch, this.cachedEpochs.get(accountId) ?? -1) + 1;
    this.cachedEpochs.set(accountId, next);
    return next + 1;
  }

  async completeEpochChange(accountId: string, epoch: number): Promise<void> {
    this.cachedEpochs.set(accountId, Math.max(this.cachedEpochs.get(accountId) ?? -1, epoch));
  }

  /** Transaction de l'appelant (ADR 0014) : époque écrite « en base ». */
  commitEpoch(accountId: string, epoch: number): void {
    const account = this.accounts.get(accountId);
    if (account) account.epoch = Math.max(account.epoch, epoch);
  }
}

export class InMemoryProfileLockPolicies extends ProfileLockPolicies {
  readonly policies = new Map<string, ProfileLockPolicy>();

  set(policy: ProfileLockPolicy): void {
    this.policies.set(policy.profileId, policy);
  }

  async find(accountId: string, profileId: string): Promise<ProfileLockPolicy | null> {
    const policy = this.policies.get(profileId);
    return policy?.accountId === accountId ? policy : null;
  }
}

/** Même politique que l'adaptateur Redis, réservations comprises. */
export class InMemoryRateLimiter extends RateLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly pending = new Map<string, Set<string>>();
  private next = 0;

  async check(subjects: readonly RateLimitSubject[], now: Date): Promise<RateLimitCheck> {
    let wait = 0;
    let busy = false;
    for (const subject of subjects) {
      const threshold = subject.threshold ?? RATE_LIMIT_POLICIES[subject.scope].threshold;
      const times = this.recent(subject, now);
      const last = times.at(-1);
      const delay = rateLimitDelayMs(times.length, threshold);
      if (delay > 0 && last !== undefined) wait = Math.max(wait, last + delay - now.getTime());
      const inflight = this.pending.get(this.key(subject))?.size ?? 0;
      if (inflight > 0 && times.length + inflight >= threshold) busy = true;
    }
    if (wait > 0) return { allowed: false, retryAfterMs: wait, reservation: null };
    if (busy) return { allowed: false, retryAfterMs: 1000, reservation: null };
    this.next += 1;
    const reservation = `r${this.next}`;
    for (const subject of subjects) {
      const key = this.key(subject);
      this.pending.set(key, new Set([...(this.pending.get(key) ?? []), reservation]));
    }
    return { allowed: true, retryAfterMs: 0, reservation };
  }

  async recordFailure(
    subjects: readonly RateLimitSubject[],
    now: Date,
    reservation: string,
  ): Promise<void> {
    for (const subject of subjects) {
      this.failures.set(this.key(subject), [...this.recent(subject, now), now.getTime()]);
      this.pending.get(this.key(subject))?.delete(reservation);
    }
  }

  async recordSuccess(subjects: readonly RateLimitSubject[], reservation: string): Promise<void> {
    for (const subject of subjects) {
      if (RATE_LIMIT_POLICIES[subject.scope].resetOnSuccess)
        this.failures.delete(this.key(subject));
      this.pending.get(this.key(subject))?.delete(reservation);
    }
  }

  private recent(subject: RateLimitSubject, now: Date): number[] {
    const { windowMs } = RATE_LIMIT_POLICIES[subject.scope];
    return (this.failures.get(this.key(subject)) ?? []).filter((t) => t > now.getTime() - windowMs);
  }

  private key(subject: RateLimitSubject): string {
    return [subject.scope, ...subject.parts].join('\u0000');
  }
}

/** Toujours le premier : chaque événement est écrit (tests). */
export class InMemoryEventThrottle extends EventThrottle {
  async firstInWindow(): Promise<boolean> {
    return true;
  }
}

export class InMemorySecurityLog extends SecurityLog {
  readonly entries: Parameters<SecurityLog['record']>[0][] = [];

  async record(entry: Parameters<SecurityLog['record']>[0]): Promise<void> {
    this.entries.push(entry);
  }
}

export class InMemoryMailSender extends MailSender {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}
