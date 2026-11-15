import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfig } from '../config/env';

/** Attente maximale d'une reconnexion en cours (`ready()`), avant refus. */
const READY_WAIT_MS = 2500;

/** Commande interdite (ACL) ou renommée / inconnue : `CONFIG` n'est pas disponible. */
const DENIED = /^(?:NOPERM|ERR unknown (?:sub)?command)/i;

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
    this.connecting ??= this.connect().finally(() => {
      this.connecting = undefined;
    });
    await this.connecting;
    return this.client;
  }

  /**
   * Connexion bornée : un Redis à moitié mort (reconnexion en cours, file hors ligne désactivée)
   * ne doit jamais laisser une promesse pendue, que tous les appelants partageraient. Refus
   * rapide (503) sur erreur, fermeture ou délai dépassé.
   */
  private connect(): Promise<void> {
    if (this.client.status === 'wait' || this.client.status === 'end') {
      return this.client.connect();
    }
    return new Promise<void>((resolve, reject) => {
      const done = (settle: () => void): void => {
        clearTimeout(timer);
        this.client.off('ready', onReady);
        this.client.off('error', onFail);
        this.client.off('close', onFail);
        settle();
      };
      const onReady = (): void => {
        done(resolve);
      };
      const onFail = (error?: unknown): void => {
        done(() => {
          reject(error instanceof Error ? error : new Error('Redis indisponible'));
        });
      };
      const timer = setTimeout(onFail, READY_WAIT_MS);
      this.client.once('ready', onReady);
      this.client.once('error', onFail);
      this.client.once('close', onFail);
    });
  }

  private connecting: Promise<void> | undefined;

  /** Rejette si Redis ne répond pas. */
  async ping(): Promise<void> {
    await (await this.ready()).ping();
  }

  /**
   * ADR 0013 : `noeviction`, sinon une marque de révocation ou un compteur peuvent disparaître.
   * `null` si Redis refuse la commande (`CONFIG` interdit sur un Redis géré) : la politique se
   * vérifie alors à la mise en production. Une panne de connexion, elle, est propagée.
   */
  async evictionPolicy(): Promise<string | null> {
    const client = await this.ready();
    try {
      const reply: unknown = await client.config('GET', 'maxmemory-policy');
      // Réponse inattendue : une panne, pas un refus (la sonde tombe).
      if (!Array.isArray(reply) || typeof reply[1] !== 'string')
        throw new Error('réponse inattendue');
      return reply[1];
    } catch (error) {
      // Seulement une commande interdite ou inconnue : tout autre refus est une panne.
      if (error instanceof Error && error.name === 'ReplyError' && DENIED.test(error.message)) {
        return null;
      }
      throw error;
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
