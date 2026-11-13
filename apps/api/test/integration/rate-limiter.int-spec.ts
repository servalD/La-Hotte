import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../src/platform/config/env';
import { RedisService } from '../../src/platform/redis/redis.service';
import {
  rateLimitDelayMs,
  type RateLimitSubject,
} from '../../src/modules/identity/domain/rate-limit';
import {
  limitedAddress,
  RedisEventThrottle,
  RedisRateLimiter,
} from '../../src/modules/identity/infrastructure/redis-rate-limiter';

// AUTH-07, ADR 0013 « Limitation » : Redis réel, scripts Lua atomiques.

const config = {
  env: {
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    KEY_HMAC_SECRET: process.env.KEY_HMAC_SECRET ?? 'test-key-hmac-secret-0123456789abcdef',
  },
} as AppConfig;

let redis: RedisService;
let limiter: RedisRateLimiter;

beforeAll(() => {
  redis = new RedisService(config);
  limiter = new RedisRateLimiter(config, redis);
});

afterAll(() => {
  redis.onModuleDestroy();
});

const t0 = new Date('2026-11-13T12:00:00Z');
const at = (ms: number): Date => new Date(t0.getTime() + ms);

/** Essai complet : réservation puis échec. */
async function fail(subjects: RateLimitSubject[], times: number, when = t0): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    const check = await limiter.check(subjects, when);
    if (!check.reservation) throw new Error('essai refusé pendant la préparation');
    await limiter.recordFailure(subjects, when, check.reservation);
  }
}

describe('RedisRateLimiter', () => {
  it('délai croissant à partir du seuil, même formule que le domaine', async () => {
    const pair: RateLimitSubject = { scope: 'login_pair', parts: [randomUUID(), '203.0.113.7'] };
    await fail([pair], 5);
    for (let failures = 5; failures <= 8; failures += 1) {
      const wait = await limiter.check([pair], t0);
      expect(wait).toEqual({
        allowed: false,
        retryAfterMs: rateLimitDelayMs(failures, 5),
        reservation: null,
      });
      const later = await limiter.check([pair], at(rateLimitDelayMs(failures, 5)));
      if (!later.reservation) throw new Error('essai attendu');
      await limiter.recordFailure([pair], t0, later.reservation);
    }
  });

  it('revue SEC-40 B2 : une rafale parallèle sous le seuil ne dépasse jamais le seuil', async () => {
    const factor: RateLimitSubject = { scope: 'second_factor', parts: [randomUUID()] };
    const burst = await Promise.all(Array.from({ length: 200 }, () => limiter.check([factor], t0)));
    expect(burst.filter((check) => check.allowed)).toHaveLength(5);
  });

  it('sous le seuil, échecs + essais en cours ≤ seuil ; une réservation rendue libère la place', async () => {
    const pair: RateLimitSubject = { scope: 'login_pair', parts: [randomUUID(), '203.0.113.10'] };
    await fail([pair], 3);
    const a = await limiter.check([pair], t0);
    const b = await limiter.check([pair], t0);
    const c = await limiter.check([pair], t0);
    expect([a.allowed, b.allowed, c.allowed]).toEqual([true, true, false]);
    if (!a.reservation) throw new Error('réservation attendue');
    await limiter.recordSuccess([pair], a.reservation);
    expect((await limiter.check([pair], t0)).allowed).toBe(true);
  });

  it('au-delà du seuil, après le délai : un seul essai à la fois', async () => {
    const pair: RateLimitSubject = { scope: 'login_pair', parts: [randomUUID(), '203.0.113.8'] };
    await fail([pair], 5);
    expect((await limiter.check([pair], at(500))).allowed).toBe(false);
    const [first, second] = await Promise.all([
      limiter.check([pair], at(1_000)),
      limiter.check([pair], at(1_000)),
    ]);
    expect([first.allowed, second.allowed].sort()).toEqual([false, true]);
  });

  it('revue SEC-40 M1 : rendre une réservation ne libère pas celle d’un autre essai', async () => {
    // Compteur jamais vidé par un succès : seule la réservation est en jeu.
    const pair: RateLimitSubject = { scope: 'login_account', parts: [randomUUID()] };
    await fail([pair], 20);
    const held = await limiter.check([pair], at(1_000));
    expect(held.allowed).toBe(true);
    await limiter.recordSuccess([pair], 'reservation-etrangere');
    expect((await limiter.check([pair], at(1_000))).allowed).toBe(false);
  });

  it('ADR 0013 : un succès vide le couple (compte, IP), jamais le compteur par compte ni par IP', async () => {
    const account = randomUUID();
    const pair: RateLimitSubject = { scope: 'login_pair', parts: [account, '203.0.113.9'] };
    const byAccount: RateLimitSubject = { scope: 'login_account', parts: [account] };
    await fail([byAccount], 20);
    const check = await limiter.check([pair], t0);
    if (!check.reservation) throw new Error('réservation attendue');
    await limiter.recordSuccess([pair, byAccount], check.reservation);

    expect((await limiter.check([pair], at(1))).allowed).toBe(true);
    expect((await limiter.check([byAccount], at(1))).allowed).toBe(false);
  });

  it('seuil propre à un appareil de confiance (50 au lieu de 20)', async () => {
    const account: RateLimitSubject = { scope: 'login_account', parts: [randomUUID()] };
    await fail([account], 20);
    expect((await limiter.check([account], t0)).allowed).toBe(false);
    expect((await limiter.check([{ ...account, threshold: 50 }], t0)).allowed).toBe(true);
  });

  it('fenêtre glissante d’une heure : les échecs anciens ne comptent plus', async () => {
    const account: RateLimitSubject = { scope: 'login_account', parts: [randomUUID()] };
    await fail([account], 20);
    expect((await limiter.check([account], at(60 * 60_000 + 1))).allowed).toBe(true);
  });

  it('ADR 0013 : clés HMAC, ni e-mail ni adresse IP en clair dans Redis', async () => {
    const email = `victime-${randomUUID()}@lahotte.test`;
    await fail([{ scope: 'login_pair', parts: [email, '198.51.100.23'] }], 1);
    const keys = await redis.client.keys('rl*');
    expect(keys.some((key) => key.includes(email) || key.includes('198.51.100.23'))).toBe(false);
  });

  it('IPv6 réduite à son /64 : deux adresses du même bloc partagent le compteur', async () => {
    expect(limitedAddress('2001:db8:1:2:aaaa::1')).toBe(limitedAddress('2001:db8:1:2:bbbb::9'));
    expect(limitedAddress('2001:db8:1:2::1')).not.toBe(limitedAddress('2001:db8:1:3::1'));
    expect(limitedAddress('::ffff:203.0.113.7')).toBe('203.0.113.7');

    const ip: RateLimitSubject = { scope: 'login_ip', parts: [`2001:db8:${randomInt()}:9:1::1`] };
    await fail([ip], 50);
    const neighbour: RateLimitSubject = {
      scope: 'login_ip',
      parts: [ip.parts[0]?.replace(':1::1', ':ffff::2') ?? ''],
    };
    expect((await limiter.check([neighbour], t0)).allowed).toBe(false);
  });

  it('Redis indisponible : 503, jamais d’ouverture par défaut', async () => {
    const down = new RedisService({ env: { REDIS_URL: 'redis://127.0.0.1:1' } } as AppConfig);
    const broken = new RedisRateLimiter(config, down);
    await expect(
      broken.check([{ scope: 'login_ip', parts: ['203.0.113.1'] }], t0),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    down.onModuleDestroy();
  });
});

describe('RedisEventThrottle (revue SEC-40, I4)', () => {
  it('une fois par clé et par fenêtre ; adresses du même /64 confondues ; HMAC', async () => {
    const throttle = new RedisEventThrottle(config, redis);
    const block = `2001:db8:${randomInt()}:1`;
    expect(await throttle.firstInWindow(['csrf.rejected', `${block}::1`], 60_000)).toBe(true);
    expect(await throttle.firstInWindow(['csrf.rejected', `${block}::2`], 60_000)).toBe(false);
    const other = `2001:db8:${randomInt()}:2::1`;
    expect(await throttle.firstInWindow(['csrf.rejected', other], 60_000)).toBe(true);
    const keys = await redis.client.keys('throttle:*');
    expect(keys.some((key) => key.includes(block) || key.includes('2001:db8'))).toBe(false);
  });
});

function randomInt(): string {
  return Math.floor(Math.random() * 0xffff).toString(16);
}
