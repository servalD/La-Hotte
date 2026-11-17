import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../platform/redis/redis.service';
import { ACCOUNT_SEARCHES_PER_HOUR, AccountSearchQuota } from '../domain/account-directory';

const HOUR_MS = 3_600_000;

/** ADM-10 : fenêtre d'une heure par administrateur, comptée dans Redis. Redis absent : refus. */
@Injectable()
export class RedisAccountSearchQuota extends AccountSearchQuota {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async take(actorAccountId: string, now: Date): Promise<boolean> {
    const bucket = Math.floor(now.getTime() / HOUR_MS);
    const key = `admin-search:${actorAccountId}:${bucket}`;
    try {
      const count = await this.redis.client.incr(key);
      if (count === 1) await this.redis.client.pexpire(key, HOUR_MS);
      return count <= ACCOUNT_SEARCHES_PER_HOUR;
    } catch {
      return false;
    }
  }
}

/** Double des tests. */
export class InMemoryAccountSearchQuota extends AccountSearchQuota {
  private readonly counts = new Map<string, number>();

  take(actorAccountId: string): Promise<boolean> {
    const count = (this.counts.get(actorAccountId) ?? 0) + 1;
    this.counts.set(actorAccountId, count);
    return Promise.resolve(count <= ACCOUNT_SEARCHES_PER_HOUR);
  }

  reset(): void {
    this.counts.clear();
  }
}
