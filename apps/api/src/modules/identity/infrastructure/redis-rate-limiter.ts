import { createHmac, randomBytes } from 'node:crypto';
import { isIP, isIPv6 } from 'node:net';
import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AppConfig } from '../../../platform/config/env';
import { RedisService } from '../../../platform/redis/redis.service';
import { EventThrottle, type RateLimitCheck, RateLimiter } from '../domain/ports';
import {
  RATE_LIMIT_BASE_DELAY_MS,
  RATE_LIMIT_MAX_DELAY_MS,
  RATE_LIMIT_POLICIES,
  type RateLimitSubject,
} from '../domain/rate-limit';
import { IdentityUnavailableError } from '../domain/session.errors';

/**
 * Durée maximale d'une réservation : un processus qui meurt avant l'issue de l'essai ne bloque pas
 * le sujet plus longtemps.
 */
const RESERVATION_MS = 10_000;

/**
 * Vérification et réservation atomiques de tous les sujets. Pour chacun : purge des échecs hors
 * fenêtre et des réservations expirées ; délai croissant au-delà du seuil (même formule que
 * `rateLimitDelayMs`) ; puis capacité : une réservation est permise si aucune n'est en cours, ou
 * si échecs + réservations en cours restent sous le seuil. Une rafale parallèle sous le seuil ne
 * passe donc pas tout entière avant d'être comptée.
 * Renvoie l'attente en millisecondes, 0 si l'essai est réservé.
 * KEYS : compteur₁, réservations₁, compteur₂, réservations₂…
 * ARGV : maintenant, base, plafond, réservation, puis fenêtre₁, seuil₁, fenêtre₂, seuil₂…
 */
const CHECK = `
local now = tonumber(ARGV[1])
local base = tonumber(ARGV[2])
local cap = tonumber(ARGV[3])
local wait = 0
local busy = false
for i = 1, #KEYS / 2 do
  local counter = KEYS[2 * i - 1]
  local pending = KEYS[2 * i]
  local window = tonumber(ARGV[3 + 2 * i])
  local threshold = tonumber(ARGV[4 + 2 * i])
  redis.call('ZREMRANGEBYSCORE', counter, '-inf', now - window)
  redis.call('ZREMRANGEBYSCORE', pending, '-inf', now)
  local failures = redis.call('ZCARD', counter)
  local inflight = redis.call('ZCARD', pending)
  if failures >= threshold then
    local last = tonumber(redis.call('ZRANGE', counter, -1, -1, 'WITHSCORES')[2])
    local delay = math.min(base * 2 ^ math.min(failures - threshold, 30), cap)
    local remaining = last + delay - now
    if remaining > wait then wait = remaining end
  end
  if inflight > 0 and failures + inflight >= threshold then busy = true end
end
if wait > 0 then return math.ceil(wait) end
if busy then return base end
for i = 1, #KEYS / 2 do
  redis.call('ZADD', KEYS[2 * i], now + ${RESERVATION_MS}, ARGV[4])
  redis.call('PEXPIRE', KEYS[2 * i], ${RESERVATION_MS})
end
return 0`;

/**
 * Échec : horodatage ajouté à chaque compteur, réservation rendue.
 * ARGV : maintenant, membre, réservation, puis fenêtres.
 */
const FAIL = `
for i = 1, #KEYS / 2 do
  redis.call('ZADD', KEYS[2 * i - 1], ARGV[1], ARGV[2])
  redis.call('PEXPIRE', KEYS[2 * i - 1], ARGV[3 + i])
  redis.call('ZREM', KEYS[2 * i], ARGV[3])
end
return 1`;

/**
 * Réduit une adresse IPv6 à son /64 (ADR 0013) : un hôte en dispose d'ordinaire d'un bloc entier.
 * Les adresses IPv4 (y compris projetées en IPv6) restent entières.
 */
export function limitedAddress(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  if (!isIPv6(ip)) return ip;
  const [head = '', tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((group) => parseInt(group || '0', 16).toString(16))
    .join(':')}::/64`;
}

/**
 * Adaptateur Redis du port `RateLimiter` (AUTH-07, ADR 0013). Clés : HMAC à clé serveur
 * (`KEY_HMAC_SECRET`) de la portée et des parties, jamais un e-mail ni une adresse IP en clair.
 * Redis indisponible : `IdentityUnavailableError` (503), jamais d'ouverture par défaut.
 */
@Injectable()
export class RedisRateLimiter extends RateLimiter {
  private readonly secret: string;

  constructor(
    config: AppConfig,
    private readonly redisService: RedisService,
  ) {
    super();
    this.secret = config.env.KEY_HMAC_SECRET;
  }

  async check(subjects: readonly RateLimitSubject[], now: Date): Promise<RateLimitCheck> {
    const reservation = randomBytes(12).toString('hex');
    if (subjects.length === 0) return { allowed: true, retryAfterMs: 0, reservation };
    const keys = subjects.flatMap((subject) => this.keys(subject));
    const args = subjects.flatMap((subject) => {
      const policy = RATE_LIMIT_POLICIES[subject.scope];
      return [String(policy.windowMs), String(subject.threshold ?? policy.threshold)];
    });
    const wait = Number(
      await this.redis((r) =>
        r.eval(
          CHECK,
          keys.length,
          ...keys,
          String(now.getTime()),
          String(RATE_LIMIT_BASE_DELAY_MS),
          String(RATE_LIMIT_MAX_DELAY_MS),
          reservation,
          ...args,
        ),
      ),
    );
    return wait <= 0
      ? { allowed: true, retryAfterMs: 0, reservation }
      : { allowed: false, retryAfterMs: wait, reservation: null };
  }

  async recordFailure(
    subjects: readonly RateLimitSubject[],
    now: Date,
    reservation: string,
  ): Promise<void> {
    if (subjects.length === 0) return;
    const keys = subjects.flatMap((subject) => this.keys(subject));
    const windows = subjects.map((subject) => String(RATE_LIMIT_POLICIES[subject.scope].windowMs));
    // Membre unique : deux échecs à la même milliseconde comptent pour deux.
    const member = `${now.getTime()}-${randomBytes(6).toString('hex')}`;
    await this.redis((r) =>
      r.eval(FAIL, keys.length, ...keys, String(now.getTime()), member, reservation, ...windows),
    );
  }

  async recordSuccess(subjects: readonly RateLimitSubject[], reservation: string): Promise<void> {
    if (subjects.length === 0) return;
    await this.redis((r) => {
      const batch = r.multi();
      for (const subject of subjects) {
        const [counter, pending] = this.keys(subject);
        if (RATE_LIMIT_POLICIES[subject.scope].resetOnSuccess) batch.del(counter);
        // Seule cette réservation est rendue, jamais celle d'un autre essai (M1).
        batch.zrem(pending, reservation);
      }
      return batch.exec();
    });
  }

  private keys(subject: RateLimitSubject): [string, string] {
    const digest = createHmac('sha256', this.secret)
      // Une partie qui est une adresse IP est réduite (/64 en IPv6) avant le HMAC.
      .update(
        [
          subject.scope,
          ...subject.parts.map((part) => (isIP(part) ? limitedAddress(part) : part)),
        ].join('\u0000'),
        'utf8',
      )
      .digest('hex');
    return [`rl:${subject.scope}:${digest}`, `rl-pending:${subject.scope}:${digest}`];
  }

  private async redis<T>(run: (client: Redis) => Promise<T>): Promise<T> {
    try {
      return await run(await this.redisService.ready());
    } catch {
      throw new IdentityUnavailableError();
    }
  }
}

/**
 * Premier événement d'une fenêtre, par HMAC de ses parties (adresse IP réduite au /64). Redis
 * indisponible : faux, l'événement n'est pas écrit (le refus, lui, reste).
 */
@Injectable()
export class RedisEventThrottle extends EventThrottle {
  private readonly secret: string;

  constructor(
    config: AppConfig,
    private readonly redisService: RedisService,
  ) {
    super();
    this.secret = config.env.KEY_HMAC_SECRET;
  }

  async firstInWindow(parts: readonly string[], windowMs: number): Promise<boolean> {
    const digest = createHmac('sha256', this.secret)
      .update(
        ['throttle', ...parts.map((part) => (isIP(part) ? limitedAddress(part) : part))].join(
          '\u0000',
        ),
        'utf8',
      )
      .digest('hex');
    try {
      const client = await this.redisService.ready();
      return (await client.set(`throttle:${digest}`, '1', 'PX', windowMs, 'NX')) === 'OK';
    } catch {
      return false;
    }
  }
}
