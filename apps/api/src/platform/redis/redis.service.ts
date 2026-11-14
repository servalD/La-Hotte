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
      // Un Redis figé (et non arrêté) doit donner un refus rapide (503), pas une requête pendue.
      commandTimeout: 1000,
      connectTimeout: 2000,
    });
    // Sans écouteur, une erreur de connexion ferait tomber le processus.
    this.client.on('error', () => undefined);
  }

  /**
   * Client connecté. Sans file hors ligne, une commande envoyée avant la connexion échouerait :
   * on connecte d'abord (connexion paresseuse).
   */
  async ready(): Promise<Redis> {
    if (this.client.status === 'ready') return this.client;
    // Une seule connexion à la fois : les appels simultanés attendent la même.
    this.connecting ??= (
      this.client.status === 'wait' || this.client.status === 'end'
        ? this.client.connect()
        : new Promise<void>((resolve, reject) => {
            const onReady = (): void => {
              this.client.off('error', onError);
              resolve();
            };
            const onError = (error: unknown): void => {
              this.client.off('ready', onReady);
              reject(error instanceof Error ? error : new Error('Redis indisponible'));
            };
            this.client.once('ready', onReady);
            this.client.once('error', onError);
          })
    ).finally(() => {
      this.connecting = undefined;
    });
    await this.connecting;
    return this.client;
  }

  private connecting: Promise<void> | undefined;

  /** Rejette si Redis ne répond pas. */
  async ping(): Promise<void> {
    await (await this.ready()).ping();
  }

  /** ADR 0013 : `noeviction`, sinon une marque de révocation ou un compteur peuvent disparaître. */
  async evictionPolicy(): Promise<string | null> {
    const reply: unknown = await (await this.ready()).config('GET', 'maxmemory-policy');
    return Array.isArray(reply) && typeof reply[1] === 'string' ? reply[1] : null;
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
