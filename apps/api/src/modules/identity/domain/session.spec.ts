import {
  maxDelayFor,
  rateLimitDelayMs,
  RATE_LIMIT_MAX_DELAY_MS,
  RATE_LIMIT_POLICIES,
} from './rate-limit';
import {
  hasRecentReauth,
  isProfileUnlocked,
  newSessionExpiry,
  type ProfileLockPolicy,
  rejectSession,
  type SessionRecord,
  sessionLifetime,
  slideExpiry,
} from './session';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const now = new Date('2026-11-13T12:00:00Z');
const at = (offsetMs: number): Date => new Date(now.getTime() + offsetMs);

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's',
    accountId: 'a',
    role: 'USER',
    tokenHash: 'h',
    authEpoch: 3,
    activeProfileId: 'p',
    reauthAt: null,
    trustedDeviceId: null,
    userAgent: '',
    lastSeenAt: now,
    createdAt: at(-DAY),
    expiresAt: at(DAY),
    absoluteExpiresAt: at(10 * DAY),
    ...overrides,
  };
}

const policy = (overrides: Partial<ProfileLockPolicy> = {}): ProfileLockPolicy => ({
  profileId: 'p',
  accountId: 'a',
  hasPin: true,
  relock: 'IDLE_15',
  pinStamp: 'empreinte-1',
  ...overrides,
});

describe('Durées de session (AUTH-04, AUTH-05)', () => {
  it('30 jours glissants, 90 absolus ; 12 h et 24 h pour ADMIN et MODERATOR', () => {
    expect(sessionLifetime('USER')).toEqual({ slidingMs: 30 * DAY, absoluteMs: 90 * DAY });
    expect(sessionLifetime('ADMIN')).toEqual({ slidingMs: DAY / 2, absoluteMs: DAY });
    expect(sessionLifetime('MODERATOR')).toEqual({ slidingMs: DAY / 2, absoluteMs: DAY });
    expect(newSessionExpiry('USER', now)).toEqual({
      expiresAt: at(30 * DAY),
      absoluteExpiresAt: at(90 * DAY),
    });
  });

  it('ADR 0013 : l’expiration glissante ne dépasse jamais la durée absolue', () => {
    expect(slideExpiry(record({ absoluteExpiresAt: at(DAY) }), now)).toEqual(at(DAY));
    expect(slideExpiry(record(), now)).toEqual(at(10 * DAY));
    expect(slideExpiry(record({ absoluteExpiresAt: at(60 * DAY) }), now)).toEqual(at(30 * DAY));
  });

  it('ADR 0013 : refus pour époque différente, durée glissante ou absolue dépassée', () => {
    expect(rejectSession(record(), 3, now)).toBeNull();
    expect(rejectSession(record(), 4, now)).toBe('epoch');
    expect(rejectSession(record({ expiresAt: now }), 3, now)).toBe('expired');
    expect(rejectSession(record({ absoluteExpiresAt: now, expiresAt: now }), 3, now)).toBe(
      'absolute',
    );
  });
});

describe('Déverrouillage du profil (PIN-02, PIN-07)', () => {
  const unlock = { profileId: 'p', at: at(-MINUTE), nonce: null, pinStamp: 'empreinte-1' };

  it('PIN-05 : un déverrouillage donné par un autre PIN que le PIN courant ne vaut rien', () => {
    expect(
      isProfileUnlocked({
        policy: policy({ pinStamp: 'empreinte-2' }),
        unlock,
        unlockCookie: null,
        now,
      }),
    ).toBe(false);
    expect(
      isProfileUnlocked({
        policy: policy(),
        unlock: { ...unlock, pinStamp: null },
        unlockCookie: null,
        now,
      }),
    ).toBe(false);
  });

  it('profil sans PIN : toujours déverrouillé', () => {
    expect(
      isProfileUnlocked({
        policy: policy({ hasPin: false }),
        unlock: null,
        unlockCookie: null,
        now,
      }),
    ).toBe(true);
  });

  it('profil avec PIN : verrouillé sans déverrouillage, ou déverrouillage d’un autre profil', () => {
    expect(isProfileUnlocked({ policy: policy(), unlock: null, unlockCookie: null, now })).toBe(
      false,
    );
    expect(
      isProfileUnlocked({
        policy: policy(),
        unlock: { ...unlock, profileId: 'autre' },
        unlockCookie: null,
        now,
      }),
    ).toBe(false);
    expect(isProfileUnlocked({ policy: policy(), unlock, unlockCookie: null, now })).toBe(true);
  });

  it('IDLE_15 : reverrouillé à 15 minutes sans action ; NEVER : jamais', () => {
    const idle = { ...unlock, at: at(-15 * MINUTE) };
    expect(isProfileUnlocked({ policy: policy(), unlock: idle, unlockCookie: null, now })).toBe(
      false,
    );
    expect(
      isProfileUnlocked({
        policy: policy({ relock: 'NEVER' }),
        unlock: { ...unlock, at: at(-DAY) },
        unlockCookie: null,
        now,
      }),
    ).toBe(true);
  });

  it('EVERY_OPEN : cookie de déverrouillage exigé et identique au nonce', () => {
    const withNonce = { ...unlock, nonce: 'nonce-1' };
    const every = policy({ relock: 'EVERY_OPEN' });
    expect(isProfileUnlocked({ policy: every, unlock: withNonce, unlockCookie: null, now })).toBe(
      false,
    );
    expect(
      isProfileUnlocked({ policy: every, unlock: withNonce, unlockCookie: 'nonce-2', now }),
    ).toBe(false);
    expect(
      isProfileUnlocked({ policy: every, unlock: withNonce, unlockCookie: 'nonce-1', now }),
    ).toBe(true);
    expect(
      isProfileUnlocked({
        policy: every,
        unlock: { ...withNonce, at: at(-16 * MINUTE) },
        unlockCookie: 'nonce-1',
        now,
      }),
    ).toBe(false);
  });
});

describe('Ré-authentification (AUTH-14)', () => {
  it('moins de 10 minutes ; jamais dans le futur ; absente refusée', () => {
    expect(hasRecentReauth(null, now, 10 * MINUTE)).toBe(false);
    expect(hasRecentReauth(at(-9 * MINUTE), now, 10 * MINUTE)).toBe(true);
    expect(hasRecentReauth(at(-10 * MINUTE), now, 10 * MINUTE)).toBe(false);
    expect(hasRecentReauth(at(-3 * MINUTE), now, 2 * MINUTE)).toBe(false);
    expect(hasRecentReauth(at(MINUTE), now, 10 * MINUTE)).toBe(false);
  });
});

describe('Limitation (AUTH-07)', () => {
  it('délai croissant à partir du seuil, plafonné à 15 minutes, jamais définitif', () => {
    expect(rateLimitDelayMs(4, 5)).toBe(0);
    expect(rateLimitDelayMs(5, 5)).toBe(1000);
    expect(rateLimitDelayMs(6, 5)).toBe(2000);
    expect(rateLimitDelayMs(7, 5)).toBe(4000);
    expect(rateLimitDelayMs(500, 5)).toBe(RATE_LIMIT_MAX_DELAY_MS);
    expect(RATE_LIMIT_MAX_DELAY_MS).toBe(15 * MINUTE);
  });

  it('second facteur : délai plafonné à une heure (revue SEC-40 de la tranche 3, I1)', () => {
    expect(maxDelayFor('second_factor')).toBe(60 * MINUTE);
    expect(maxDelayFor('login_pair')).toBe(RATE_LIMIT_MAX_DELAY_MS);
    expect(rateLimitDelayMs(500, 5, maxDelayFor('second_factor'))).toBe(60 * MINUTE);
  });

  it('ADR 0013 : seuls le couple (compte, IP) et le second facteur sont vidés par un succès', () => {
    expect(RATE_LIMIT_POLICIES.login_pair).toMatchObject({ threshold: 5, resetOnSuccess: true });
    expect(RATE_LIMIT_POLICIES.login_account).toMatchObject({
      threshold: 20,
      resetOnSuccess: false,
    });
    expect(RATE_LIMIT_POLICIES.login_ip).toMatchObject({ threshold: 50, resetOnSuccess: false });
    expect(RATE_LIMIT_POLICIES.second_factor).toMatchObject({ threshold: 5 });
  });
});
