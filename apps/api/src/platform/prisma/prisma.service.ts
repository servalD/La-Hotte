import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
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

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
