import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfig } from '../config/env';

/** Connexion Redis partagée (sessions, files, pub/sub). Paresseuse, comme Prisma. */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: AppConfig) {
    this.client = new Redis(config.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    // Sans écouteur, une erreur de connexion ferait tomber le processus.
    this.client.on('error', () => undefined);
  }

  /** Rejette si Redis ne répond pas. */
  async ping(): Promise<void> {
    if (this.client.status === 'wait' || this.client.status === 'end') {
      await this.client.connect();
    }
    await this.client.ping();
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
