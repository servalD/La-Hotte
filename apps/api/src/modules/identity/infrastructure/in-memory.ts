/* eslint-disable @typescript-eslint/require-await -- doubles synchrones derrière des ports asynchrones */
// Doubles en mémoire des ports du module, pour les tests de cas d'usage et de contrat. Ils
// reproduisent la sémantique des adaptateurs réels : cache et lignes séparés, marques de
// révocation, époque, réhydratation verrouillée.
import { createHash } from 'node:crypto';
import type {
  AccountCredentials,
  AccountTokenPurpose,
  ConsumedAccountToken,
  NewAccount,
  NewAccountToken,
  NewProfile,
  RegistrationMode,
} from '../domain/account';
import {
  AccountRepository,
  BackgroundTasks,
  IdentitySettings,
  PasswordBreachChecker,
  PasswordHasher,
} from '../domain/account.ports';
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
import {
  maxDelayFor,
  RATE_LIMIT_POLICIES,
  rateLimitDelayMs,
  type RateLimitSubject,
} from '../domain/rate-limit';
import type {
  NewTrustedDevice,
  PendingSecondFactor,
  TotpState,
  TrustedDeviceSummary,
} from '../domain/second-factor';
import {
  PendingSecondFactors,
  SecondFactorRepository,
  TrustedDeviceRepository,
} from '../domain/second-factor.ports';
import {
  MAX_PROFILES_PER_ACCOUNT,
  type PinAttempt,
  pinLockDelayMs,
  type ProfileChanges,
  type ProfileDetails,
  type ProfileMetadata,
} from '../domain/profile';
import { ProfileRepository } from '../domain/profile.ports';
import { pinStampOf } from './pin-stamp';
import type {
  AccountRole,
  CachedSession,
  PinRelock,
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

  async findOwned(accountId: string, sessionId: string): Promise<SessionRef | null> {
    const row = this.rows.get(sessionId);
    return row?.accountId === accountId
      ? { id: row.id, accountId, tokenHash: row.tokenHash }
      : null;
  }

  async listForAccount(accountId: string): Promise<SessionRecord[]> {
    return [...this.rows.values()].filter((row) => row.accountId === accountId);
  }

  /** Compte suspendu ou réactivé (purge, AUTH-15). */
  setActive(accountId: string, active: boolean): void {
    const account = this.accounts.get(accountId);
    if (account) account.active = active;
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

/** PIN des profils créés par `InMemoryProfileLockPolicies.set` avec `hasPin` (tests). */
export const TEST_PIN = '1234';

/** Hash de `FakePasswordHasher`, calculé sans attendre. */
function fakeHash(secret: string): string {
  return `fake$${createHash('sha256').update(secret).digest('hex')}`;
}

/** Empreinte du PIN `TEST_PIN` (PIN-05), à porter par un déverrouillage posé à la main. */
export const TEST_PIN_STAMP = pinStampOf(fakeHash(TEST_PIN)) ?? '';

/**
 * Profil en mémoire : les champs de l'inscription, le reste facultatif (valeurs par défaut de la
 * base à la lecture), pour que les tests qui posent un profil à la main restent courts.
 */
export interface MemoryProfile extends NewProfile {
  accountId: string;
  avatar?: string | null;
  birthdayDay?: number | null;
  birthdayMonth?: number | null;
  birthdayYear?: number | null;
  isChild?: boolean;
  pinHash?: string | null;
  pinRelock?: PinRelock;
  pinFailedCount?: number;
  pinFailuresSinceEntry?: number;
  pinLockedUntil?: Date | null;
  pinResetNoticeAt?: Date | null;
  version?: number;
  createdAt?: Date;
}

/** Magasin commun aux doubles des comptes, des réglages de verrouillage et des profils. */
export type MemoryProfiles = Map<string, MemoryProfile>;

export class InMemoryProfileLockPolicies extends ProfileLockPolicies {
  constructor(readonly profiles: MemoryProfiles = new Map()) {
    super();
  }

  /** Profil prêt à l'emploi ; avec `hasPin`, son PIN est `TEST_PIN`. */
  set(policy: Omit<ProfileLockPolicy, 'pinStamp'>): void {
    const existing = this.profiles.get(policy.profileId);
    this.profiles.set(policy.profileId, {
      id: policy.profileId,
      displayName: 'Profil de test',
      accentColor: '#336699',
      locale: 'fr',
      currency: 'EUR',
      timezone: 'Europe/Paris',
      createdAt: new Date(),
      ...existing,
      accountId: policy.accountId,
      pinHash: policy.hasPin ? fakeHash(TEST_PIN) : null,
      pinRelock: policy.relock,
    });
  }

  async find(accountId: string, profileId: string): Promise<ProfileLockPolicy | null> {
    const profile = this.profiles.get(profileId);
    if (profile?.accountId !== accountId) return null;
    return {
      profileId,
      accountId,
      hasPin: (profile.pinHash ?? null) !== null,
      relock: profile.pinRelock ?? 'IDLE_15',
      pinStamp: pinStampOf(profile.pinHash ?? null),
    };
  }
}

function details(profile: MemoryProfile): ProfileDetails {
  return {
    id: profile.id,
    accountId: profile.accountId,
    displayName: profile.displayName,
    avatar: profile.avatar ?? null,
    accentColor: profile.accentColor,
    birthdayDay: profile.birthdayDay ?? null,
    birthdayMonth: profile.birthdayMonth ?? null,
    birthdayYear: profile.birthdayYear ?? null,
    locale: profile.locale,
    currency: profile.currency,
    timezone: profile.timezone,
    isChild: profile.isChild ?? false,
    hasPin: (profile.pinHash ?? null) !== null,
    pinRelock: profile.pinRelock ?? 'IDLE_15',
    pinResetNoticeAt: profile.pinResetNoticeAt ?? null,
    version: profile.version ?? 1,
  };
}

/** Même sémantique que l'adaptateur Prisma : compte d'abord, essai compté avant d'être évalué. */
export class InMemoryProfileRepository extends ProfileRepository {
  /**
   * `sessions` : lignes de session dont la clé étrangère `active_profile_id` passe à `NULL` à la
   * suppression du profil (`ON DELETE SET NULL`), comme en base. Le cache n'est pas touché.
   */
  constructor(
    readonly profiles: MemoryProfiles = new Map(),
    private readonly sessions: InMemorySessionStore | null = null,
  ) {
    super();
  }

  private ofAccount(accountId: string): MemoryProfile[] {
    return [...this.profiles.values()]
      .filter((p) => p.accountId === accountId)
      .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  }

  private owned(accountId: string, profileId: string): MemoryProfile | null {
    const profile = this.profiles.get(profileId);
    return profile?.accountId === accountId ? profile : null;
  }

  async listIds(accountId: string): Promise<string[]> {
    return this.ofAccount(accountId).map((p) => p.id);
  }

  async listMetadata(accountId: string): Promise<ProfileMetadata[]> {
    return this.ofAccount(accountId).map((p) => {
      const d = details(p);
      return {
        id: d.id,
        displayName: d.displayName,
        avatar: d.avatar,
        accentColor: d.accentColor,
        hasPin: d.hasPin,
        isChild: d.isChild,
      };
    });
  }

  async findDetails(accountId: string, profileId: string): Promise<ProfileDetails | null> {
    const profile = this.owned(accountId, profileId);
    return profile ? details(profile) : null;
  }

  async create(
    accountId: string,
    profile: NewProfile & { readonly isChild: boolean },
    now: Date,
  ): Promise<'created' | 'limit'> {
    if (this.ofAccount(accountId).length >= MAX_PROFILES_PER_ACCOUNT) return 'limit';
    this.profiles.set(profile.id, { ...profile, accountId, createdAt: now, version: 1 });
    return 'created';
  }

  async update(
    accountId: string,
    profileId: string,
    expectedVersion: number,
    changes: ProfileChanges,
  ): Promise<
    | { readonly status: 'updated'; readonly profile: ProfileDetails }
    | { readonly status: 'stale' | 'missing' }
  > {
    const profile = this.owned(accountId, profileId);
    if (!profile) return { status: 'missing' };
    if ((profile.version ?? 1) !== expectedVersion) return { status: 'stale' };
    const next: MemoryProfile = {
      ...profile,
      displayName: changes.displayName ?? profile.displayName,
      locale: changes.locale ?? profile.locale,
      currency: changes.currency ?? profile.currency,
      timezone: changes.timezone ?? profile.timezone,
      pinRelock: changes.pinRelock ?? profile.pinRelock,
      version: expectedVersion + 1,
    };
    if (changes.birthday !== undefined) {
      next.birthdayDay = changes.birthday?.day ?? null;
      next.birthdayMonth = changes.birthday?.month ?? null;
      next.birthdayYear = changes.birthday?.year ?? null;
    }
    this.profiles.set(profileId, next);
    return { status: 'updated', profile: details(next) };
  }

  async setChild(accountId: string, profileId: string, isChild: boolean): Promise<boolean> {
    const profile = this.owned(accountId, profileId);
    if (!profile) return false;
    this.profiles.set(profileId, { ...profile, isChild, version: (profile.version ?? 1) + 1 });
    return true;
  }

  async delete(accountId: string, profileId: string): Promise<'deleted' | 'last' | 'missing'> {
    if (!this.owned(accountId, profileId)) return 'missing';
    if (this.ofAccount(accountId).length <= 1) return 'last';
    this.profiles.delete(profileId);
    for (const [id, row] of this.sessions?.rows ?? []) {
      if (row.activeProfileId === profileId) {
        this.sessions?.rows.set(id, { ...row, activeProfileId: null });
      }
    }
    return 'deleted';
  }

  async countPinAttempt(
    accountId: string,
    profileId: string,
    now: Date,
  ): Promise<PinAttempt | null> {
    const profile = this.owned(accountId, profileId);
    if (!profile) return null;
    if (!profile.pinHash) return { kind: 'no_pin' };
    const lockedUntil = profile.pinLockedUntil ?? null;
    if (lockedUntil && lockedUntil.getTime() > now.getTime()) {
      return { kind: 'locked', retryAfterMs: lockedUntil.getTime() - now.getTime() };
    }
    const failures = (profile.pinFailedCount ?? 0) + 1;
    const delay = pinLockDelayMs(failures);
    profile.pinFailedCount = failures;
    profile.pinFailuresSinceEntry = (profile.pinFailuresSinceEntry ?? 0) + 1;
    profile.pinLockedUntil = delay > 0 ? new Date(now.getTime() + delay) : null;
    return {
      kind: 'counted',
      pinHash: profile.pinHash,
      pinStamp: pinStampOf(profile.pinHash) ?? '',
      failures,
    };
  }

  async recordPinSuccess(
    accountId: string,
    profileId: string,
    verifiedHash: string,
  ): Promise<boolean> {
    const profile = this.owned(accountId, profileId);
    if (profile?.pinHash !== verifiedHash) return false;
    profile.pinFailedCount = 0;
    profile.pinLockedUntil = null;
    // L'essai juste a été compté d'avance comme une erreur.
    profile.pinFailuresSinceEntry = Math.max(0, (profile.pinFailuresSinceEntry ?? 0) - 1);
    return true;
  }

  async takeFailuresSinceEntry(accountId: string, profileId: string): Promise<number> {
    const profile = this.owned(accountId, profileId);
    if (!profile) return 0;
    const failures = profile.pinFailuresSinceEntry ?? 0;
    profile.pinFailuresSinceEntry = 0;
    return failures;
  }

  async setPin(input: {
    readonly accountId: string;
    readonly profileId: string;
    readonly pinHash: string | null;
    readonly expectedHash?: string | null;
    readonly resetNoticeAt: Date | null;
  }): Promise<{ readonly pinStamp: string | null } | null> {
    const profile = this.owned(input.accountId, input.profileId);
    if (!profile) return null;
    if (input.expectedHash !== undefined && (profile.pinHash ?? null) !== input.expectedHash) {
      return null;
    }
    profile.pinHash = input.pinHash;
    profile.pinFailedCount = 0;
    profile.pinLockedUntil = null;
    profile.pinResetNoticeAt = input.resetNoticeAt;
    return { pinStamp: pinStampOf(input.pinHash) };
  }
}

/** Même politique que l'adaptateur Redis, réservations comprises. */
export class InMemoryRateLimiter extends RateLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly pending = new Map<string, Set<string>>();
  private next = 0;

  /** Tous les tests d'un fichier partagent l'adresse de supertest : compteurs vidés entre eux. */
  reset(): void {
    this.failures.clear();
    this.pending.clear();
  }

  async check(subjects: readonly RateLimitSubject[], now: Date): Promise<RateLimitCheck> {
    let wait = 0;
    let busy = false;
    for (const subject of subjects) {
      const threshold = subject.threshold ?? RATE_LIMIT_POLICIES[subject.scope].threshold;
      const times = this.recent(subject, now);
      const last = times.at(-1);
      const delay = rateLimitDelayMs(times.length, threshold, maxDelayFor(subject.scope));
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
  ): Promise<readonly number[]> {
    return subjects.map((subject) => {
      const times = [...this.recent(subject, now), now.getTime()];
      this.failures.set(this.key(subject), times);
      this.pending.get(this.key(subject))?.delete(reservation);
      return times.length;
    });
  }

  async clear(subjects: readonly RateLimitSubject[]): Promise<void> {
    for (const subject of subjects) this.failures.delete(this.key(subject));
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

  /** Dernier jeton envoyé à `to` (fragment du lien). */
  lastToken(to: string): string | null {
    const mail = this.sent.filter((m) => m.to === to).at(-1);
    return mail ? (/#([A-Za-z0-9_-]+)/.exec(mail.text)?.[1] ?? null) : null;
  }
}

interface MemoryAccountRow {
  id: string;
  email: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  totpEnabled: boolean;
  createdAt: Date;
  /** AUTH-09 : invitation à consommer à la vérification de l'e-mail. */
  pendingInvitationId?: string | null;
  /** PRO-15 : compte tuteur d'un compte sous tutelle. */
  guardianAccountId?: string | null;
}

interface MemoryTokenRow extends NewAccountToken {
  usedAt: Date | null;
}

/**
 * Comptes en mémoire. L'état d'authentification (rôle, statut, époque) est celui du magasin de
 * sessions en mémoire, pour que sessions et comptes restent cohérents dans les tests.
 */
export class InMemoryAccountRepository extends AccountRepository {
  readonly rows = new Map<string, MemoryAccountRow>();
  readonly tokens = new Map<string, MemoryTokenRow>();
  readonly trustedDevicesRevokedAt = new Map<string, Date>();

  constructor(
    private readonly sessions: InMemorySessionStore,
    readonly profiles: MemoryProfiles = new Map(),
  ) {
    super();
  }

  /** Compte prêt à l'emploi (tests). */
  seed(row: Partial<MemoryAccountRow> & { id: string; email: string }): void {
    this.rows.set(row.id, {
      passwordHash: null,
      emailVerifiedAt: new Date(),
      totpEnabled: false,
      createdAt: new Date(),
      ...row,
    });
    this.sessions.addAccount(row.id);
  }

  private credentials(row: MemoryAccountRow): AccountCredentials {
    return {
      accountId: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      active: this.sessions.accounts.get(row.id)?.active ?? false,
      emailVerified: row.emailVerifiedAt !== null,
      totpEnabled: row.totpEnabled,
    };
  }

  async findByEmail(email: string): Promise<AccountCredentials | null> {
    const row = [...this.rows.values()].find((r) => r.email === email);
    return row ? this.credentials(row) : null;
  }

  async findById(accountId: string): Promise<AccountCredentials | null> {
    const row = this.rows.get(accountId);
    return row ? this.credentials(row) : null;
  }

  async create(
    account: NewAccount,
    verifyToken: NewAccountToken,
  ): Promise<'created' | 'email_taken'> {
    if (await this.findByEmail(account.email)) return 'email_taken';
    this.rows.set(account.id, {
      id: account.id,
      email: account.email,
      passwordHash: account.passwordHash,
      emailVerifiedAt: null,
      totpEnabled: false,
      createdAt: account.createdAt,
      pendingInvitationId: account.pendingInvitationId ?? null,
    });
    this.sessions.addAccount(account.id);
    this.profiles.set(account.profile.id, {
      ...account.profile,
      accountId: account.id,
      createdAt: account.createdAt,
    });
    this.tokens.set(verifyToken.tokenHash, { ...verifyToken, usedAt: null });
    return 'created';
  }

  async issueToken(token: NewAccountToken): Promise<void> {
    if (token.purpose !== 'EMAIL_CHANGE_CANCEL') {
      for (const row of this.tokens.values()) {
        if (row.accountId === token.accountId && row.purpose === token.purpose && !row.usedAt) {
          row.usedAt = token.createdAt;
        }
      }
    }
    this.tokens.set(token.tokenHash, { ...token, usedAt: null });
  }

  private openRow(
    tokenHash: string,
    purposes: readonly AccountTokenPurpose[],
    now: Date,
  ): MemoryTokenRow | null {
    const row = this.tokens.get(tokenHash);
    if (
      !row ||
      row.usedAt ||
      row.expiresAt.getTime() <= now.getTime() ||
      !purposes.includes(row.purpose) ||
      !this.sessions.accounts.get(row.accountId)?.active
    ) {
      return null;
    }
    return row;
  }

  async findOpenToken(
    tokenHash: string,
    purposes: readonly AccountTokenPurpose[],
    now: Date,
  ): Promise<ConsumedAccountToken | null> {
    const row = this.openRow(tokenHash, purposes, now);
    return row
      ? {
          accountId: row.accountId,
          purpose: row.purpose,
          newEmail: row.newEmail,
          createdAt: row.createdAt,
        }
      : null;
  }

  async consumeToken(
    tokenHash: string,
    purposes: readonly AccountTokenPurpose[],
    now: Date,
  ): Promise<ConsumedAccountToken | null> {
    const found = await this.findOpenToken(tokenHash, purposes, now);
    const row = this.tokens.get(tokenHash);
    if (found && row) row.usedAt = now;
    return found;
  }

  async isEmailReserved(
    email: string,
    exceptAccountId: string | null,
    now: Date,
  ): Promise<boolean> {
    return [...this.tokens.values()].some(
      (t) =>
        t.purpose === 'EMAIL_CHANGE_CANCEL' &&
        t.newEmail === email &&
        !t.usedAt &&
        t.expiresAt.getTime() > now.getTime() &&
        t.accountId !== exceptAccountId,
    );
  }

  async markEmailVerified(accountId: string, now: Date): Promise<void> {
    const row = this.rows.get(accountId);
    if (row && !row.emailVerifiedAt) {
      row.emailVerifiedAt = now;
      row.pendingInvitationId = null;
    }
  }

  async setPassword(input: {
    accountId: string;
    passwordHash: string;
    authEpoch: number;
    reset: boolean;
    verifyEmail?: boolean;
    now: Date;
  }): Promise<void> {
    const row = this.rows.get(input.accountId);
    if (!row) throw new Error('Compte introuvable');
    row.passwordHash = input.passwordHash;
    this.sessions.commitEpoch(input.accountId, input.authEpoch);
    if (!input.reset) return;
    if (!row.pendingInvitationId && (input.verifyEmail ?? true)) row.emailVerifiedAt ??= input.now;
    this.trustedDevicesRevokedAt.set(input.accountId, input.now);
    for (const token of this.tokens.values()) {
      if (token.accountId === input.accountId && token.purpose === 'PASSWORD_RESET') {
        token.usedAt ??= input.now;
      }
    }
  }

  async changeEmail(accountId: string, newEmail: string, now: Date): Promise<boolean> {
    const row = this.rows.get(accountId);
    if (
      !row ||
      (await this.isEmailReserved(newEmail, accountId, now)) ||
      [...this.rows.values()].some((r) => r.email === newEmail && r.id !== accountId)
    ) {
      return false;
    }
    row.email = newEmail;
    row.emailVerifiedAt = now;
    for (const token of this.tokens.values()) {
      if (
        token.accountId === accountId &&
        (token.purpose === 'EMAIL_VERIFY' || token.purpose === 'EMAIL_CHANGE')
      ) {
        token.usedAt ??= now;
      }
    }
    return true;
  }

  async restoreEmail(input: {
    tokenHash: string;
    accountId: string;
    authEpoch: number;
    now: Date;
  }): Promise<{ status: 'restored'; email: string } | { status: 'invalid' | 'taken' }> {
    // Tout ou rien, comme la transaction de l'adaptateur.
    const token = this.openRow(input.tokenHash, ['EMAIL_CHANGE_CANCEL'], input.now);
    const row = this.rows.get(input.accountId);
    if (token?.accountId !== input.accountId || !token.newEmail || !row) {
      return { status: 'invalid' };
    }
    const email = token.newEmail;
    if ([...this.rows.values()].some((r) => r.email === email && r.id !== input.accountId)) {
      return { status: 'taken' };
    }
    token.usedAt = input.now;
    row.email = email;
    row.passwordHash = null;
    this.sessions.commitEpoch(input.accountId, input.authEpoch);
    for (const other of this.tokens.values()) {
      if (other.accountId !== input.accountId || other.usedAt) continue;
      const later =
        other.purpose === 'EMAIL_CHANGE_CANCEL' &&
        other.createdAt.getTime() > token.createdAt.getTime();
      if (other.purpose !== 'EMAIL_CHANGE_CANCEL' || later) other.usedAt = input.now;
    }
    return { status: 'restored', email };
  }

  async findUnverifiedBefore(cutoff: Date, limit: number): Promise<string[]> {
    return [...this.rows.values()]
      .filter((r) => !r.emailVerifiedAt && r.createdAt.getTime() < cutoff.getTime())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit)
      .map((r) => r.id);
  }

  async suspendUnverified(accountId: string, cutoff: Date, authEpoch: number): Promise<boolean> {
    this.sessions.commitEpoch(accountId, authEpoch);
    const row = this.rows.get(accountId);
    if (!row || row.emailVerifiedAt || row.createdAt.getTime() >= cutoff.getTime()) return false;
    this.sessions.setActive(accountId, false);
    return true;
  }

  async deleteUnverified(accountId: string): Promise<boolean> {
    const row = this.rows.get(accountId);
    if (!row || row.emailVerifiedAt || this.sessions.accounts.get(accountId)?.active) return false;
    if ([...this.sessions.rows.values()].some((s) => s.accountId === accountId)) {
      throw new Error('Session restante (RESTRICT)');
    }
    for (const [id, profile] of this.profiles) {
      if (profile.accountId === accountId) this.profiles.delete(id);
    }
    for (const [hash, token] of this.tokens) {
      if (token.accountId === accountId) this.tokens.delete(hash);
    }
    this.rows.delete(accountId);
    this.sessions.accounts.delete(accountId);
    return true;
  }
}

/**
 * Hachage rapide pour les tests (pas d'argon2) : même contrat, dont la vérification « factice »
 * sans hash, comptée pour qu'un test puisse vérifier qu'elle a bien lieu.
 */
export class FakePasswordHasher extends PasswordHasher {
  dummyVerifications = 0;

  async hash(password: string): Promise<string> {
    return `fake$${createHash('sha256').update(password).digest('hex')}`;
  }

  async verify(hash: string | null, password: string): Promise<boolean> {
    if (hash === null) {
      this.dummyVerifications += 1;
      return false;
    }
    return hash === (await this.hash(password));
  }
}

export class InMemoryBreachChecker extends PasswordBreachChecker {
  readonly breached = new Set<string>(['motdepasse123', 'password1234']);

  async isBreached(password: string): Promise<boolean> {
    return this.breached.has(password);
  }
}

/** Tâches de fond retenues ; `flush()` les exécute toutes, comme après la réponse. */
export class InMemoryBackgroundTasks extends BackgroundTasks {
  private readonly pending: Array<{ name: string; task: () => Promise<void> }> = [];
  readonly failures: string[] = [];

  run(name: string, task: () => Promise<void>): void {
    this.pending.push({ name, task });
  }

  async flush(): Promise<void> {
    while (this.pending.length > 0) {
      const next = this.pending.shift();
      if (!next) break;
      try {
        await next.task();
      } catch {
        this.failures.push(next.name);
      }
    }
  }
}

export class StaticIdentitySettings extends IdentitySettings {
  constructor(
    public registrationMode: RegistrationMode = 'OPEN',
    readonly webOrigin = 'http://localhost:3000',
  ) {
    super();
  }
}

/**
 * TOTP et codes de secours en mémoire. L'état « TOTP actif » est celui du compte en mémoire
 * (`totpEnabled`), pour que la connexion le voie ; l'époque passe par le magasin de sessions.
 */
export class InMemorySecondFactorRepository extends SecondFactorRepository {
  readonly secrets = new Map<string, Uint8Array>();
  readonly lastSteps = new Map<string, number>();
  /** Codes de secours par compte : hash → date d'usage. */
  readonly recoveryCodes = new Map<string, Map<string, Date | null>>();

  constructor(
    private readonly accounts: InMemoryAccountRepository,
    private readonly sessions: InMemorySessionStore,
  ) {
    super();
  }

  private enabled(accountId: string): boolean {
    return this.accounts.rows.get(accountId)?.totpEnabled ?? false;
  }

  async findTotp(accountId: string): Promise<TotpState | null> {
    if (!this.accounts.rows.has(accountId)) return null;
    return {
      secretEnc: this.secrets.get(accountId) ?? null,
      enabled: this.enabled(accountId),
      lastStep: this.lastSteps.get(accountId) ?? null,
    };
  }

  async startEnrollment(accountId: string, secretEnc: Uint8Array): Promise<boolean> {
    if (!this.accounts.rows.has(accountId) || this.enabled(accountId)) return false;
    this.secrets.set(accountId, secretEnc);
    return true;
  }

  async activate(input: {
    accountId: string;
    secretEnc: Uint8Array;
    step: number;
    recoveryCodeHashes: readonly string[];
    authEpoch: number;
    now: Date;
  }): Promise<boolean> {
    const row = this.accounts.rows.get(input.accountId);
    const current = this.secrets.get(input.accountId);
    if (!row || row.totpEnabled || !current || !sameBytes(current, input.secretEnc)) return false;
    row.totpEnabled = true;
    this.sessions.commitEpoch(input.accountId, input.authEpoch);
    this.lastSteps.set(input.accountId, input.step);
    this.recoveryCodes.set(
      input.accountId,
      new Map(input.recoveryCodeHashes.map((hash) => [hash, null])),
    );
    return true;
  }

  async consumeStep(accountId: string, step: number): Promise<boolean> {
    const last = this.lastSteps.get(accountId);
    if (!this.enabled(accountId) || (last !== undefined && last >= step)) return false;
    this.lastSteps.set(accountId, step);
    return true;
  }

  async consumeRecoveryCode(accountId: string, codeHash: string, now: Date): Promise<boolean> {
    const codes = this.recoveryCodes.get(accountId);
    if (!this.enabled(accountId) || !codes?.has(codeHash) || codes.get(codeHash)) return false;
    codes.set(codeHash, now);
    return true;
  }

  async replaceRecoveryCodes(accountId: string, codeHashes: readonly string[]): Promise<boolean> {
    if (!this.enabled(accountId)) return false;
    this.recoveryCodes.set(accountId, new Map(codeHashes.map((hash) => [hash, null])));
    return true;
  }

  async countUnusedRecoveryCodes(accountId: string): Promise<number> {
    return [...(this.recoveryCodes.get(accountId)?.values() ?? [])].filter((used) => !used).length;
  }

  async disable(accountId: string, authEpoch: number, now: Date): Promise<void> {
    const row = this.accounts.rows.get(accountId);
    if (!row) throw new Error('Compte introuvable');
    row.totpEnabled = false;
    this.secrets.delete(accountId);
    this.lastSteps.delete(accountId);
    this.recoveryCodes.delete(accountId);
    this.accounts.trustedDevicesRevokedAt.set(accountId, now);
    this.sessions.commitEpoch(accountId, authEpoch);
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** Appareils de confiance en mémoire ; une réinitialisation (AUTH-06) les révoque tous. */
export class InMemoryTrustedDeviceRepository extends TrustedDeviceRepository {
  readonly devices = new Map<string, NewTrustedDevice & { revokedAt: Date | null }>();

  constructor(private readonly accounts: InMemoryAccountRepository) {
    super();
  }

  private active(device: NewTrustedDevice & { revokedAt: Date | null }, now: Date): boolean {
    const resetAt = this.accounts.trustedDevicesRevokedAt.get(device.accountId);
    return (
      !device.revokedAt &&
      device.expiresAt.getTime() > now.getTime() &&
      (!resetAt || resetAt.getTime() < device.createdAt.getTime())
    );
  }

  async create(device: NewTrustedDevice): Promise<void> {
    this.devices.set(device.id, { ...device, revokedAt: null });
  }

  async findActive(
    tokenHash: string,
    now: Date,
  ): Promise<{ id: string; accountId: string } | null> {
    const device = [...this.devices.values()].find(
      (d) => d.tokenHash === tokenHash && this.active(d, now),
    );
    return device ? { id: device.id, accountId: device.accountId } : null;
  }

  async listActive(accountId: string, now: Date): Promise<TrustedDeviceSummary[]> {
    return [...this.devices.values()]
      .filter((d) => d.accountId === accountId && this.active(d, now))
      .map(({ id, userAgent, createdAt, expiresAt }) => ({ id, userAgent, createdAt, expiresAt }));
  }

  async revoke(accountId: string, deviceId: string, now: Date): Promise<boolean> {
    const device = this.devices.get(deviceId);
    if (device?.accountId !== accountId || !this.active(device, now)) return false;
    device.revokedAt = now;
    return true;
  }
}

/** Pré-authentifications en mémoire, avec leur durée de vie (horloge réelle). */
export class InMemoryPendingSecondFactors extends PendingSecondFactors {
  readonly entries = new Map<string, { pending: PendingSecondFactor; expiresAt: number }>();

  async create(tokenHash: string, pending: PendingSecondFactor, ttlMs: number): Promise<void> {
    this.entries.set(tokenHash, { pending, expiresAt: Date.now() + ttlMs });
  }

  async find(tokenHash: string): Promise<PendingSecondFactor | null> {
    const entry = this.entries.get(tokenHash);
    if (!entry || entry.expiresAt <= Date.now()) return null;
    return entry.pending;
  }

  async consume(tokenHash: string): Promise<PendingSecondFactor | null> {
    const found = await this.find(tokenHash);
    this.entries.delete(tokenHash);
    return found;
  }

  /** Simule l'expiration des 5 minutes. */
  expireAll(): void {
    for (const entry of this.entries.values()) entry.expiresAt = 0;
  }
}
