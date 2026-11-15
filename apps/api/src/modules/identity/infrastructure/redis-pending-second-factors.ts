import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { RedisService } from '../../../platform/redis/redis.service';
import type { PendingSecondFactor } from '../domain/second-factor';
import { PendingSecondFactors } from '../domain/second-factor.ports';
import { IdentityUnavailableError } from '../domain/session.errors';

const key = (tokenHash: string): string => `preauth:${tokenHash}`;

interface Stored {
  a: string;
  e: number;
  c: number;
}

function parse(raw: string | null): PendingSecondFactor | null {
  if (raw === null) return null;
  const value = JSON.parse(raw) as Stored;
  return { accountId: value.a, epoch: value.e, createdAt: new Date(value.c) };
}

/**
 * Pré-authentifications (ADR 0013) : **Redis seul**, clé dérivée du hash du jeton (le jeton ne
 * quitte que le cookie), identifiant de compte, époque et date seulement. `GETDEL` : une seule
 * requête consomme une pré-authentification. Panne : refus en échec fermé (503).
 */
@Injectable()
export class RedisPendingSecondFactors extends PendingSecondFactors {
  constructor(private readonly redisService: RedisService) {
    super();
  }

  async create(tokenHash: string, pending: PendingSecondFactor, ttlMs: number): Promise<void> {
    const value: Stored = {
      a: pending.accountId,
      e: pending.epoch,
      c: pending.createdAt.getTime(),
    };
    await this.redis((r) => r.set(key(tokenHash), JSON.stringify(value), 'PX', ttlMs));
  }

  async find(tokenHash: string): Promise<PendingSecondFactor | null> {
    return parse(await this.redis((r) => r.get(key(tokenHash))));
  }

  async consume(tokenHash: string): Promise<PendingSecondFactor | null> {
    return parse(await this.redis((r) => r.getdel(key(tokenHash))));
  }

  private async redis<T>(run: (client: Redis) => Promise<T>): Promise<T> {
    try {
      return await run(await this.redisService.ready());
    } catch {
      throw new IdentityUnavailableError();
    }
  }
}
