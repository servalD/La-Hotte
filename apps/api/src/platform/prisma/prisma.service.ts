import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { type Prisma, PrismaClient } from '@prisma/client';
import { AppConfig } from '../config/env';

/**
 * Client Prisma connecté avec le rôle applicatif (DAT-03). La connexion est paresseuse :
 * l'application démarre sans base, /health/ready le signale.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: AppConfig) {
    super({ datasourceUrl: config.env.DATABASE_URL });
  }

  /**
   * DAT-05, ADR 0021 : lit au nom d'un profil. `app.profile_id` est posé pour la seule transaction
   * (`set_config(…, true)`), et les politiques de sécurité des lignes écartent ce que ce profil
   * ne doit jamais lire (fil des offreurs, parts, achat, suggestions). Défense supplémentaire :
   * le moteur de visibilité a déjà décidé.
   */
  asViewer<T>(profileId: string, read: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.profile_id', ${profileId}, true)`;
      return read(tx);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
