import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DEFAULT_PLATFORM_SETTINGS,
  type PlatformSettingKey,
  PlatformSettings,
  type PlatformSettingValues,
  type SettingWrite,
} from '../../shared/domain';
import { appendAudit } from '../prisma/audit-writer';
import { PrismaService } from '../prisma/prisma.service';

const REFRESH_MS = 30_000;

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/**
 * Lecture défensive d'une ligne : une valeur de forme inattendue vaut la valeur par défaut.
 * La validation des valeurs écrites appartient au domaine du module `admin` (ADM-09).
 */
export function parseSettings(
  rows: readonly { readonly key: string; readonly value: unknown }[],
): PlatformSettingValues {
  const out: { -readonly [K in PlatformSettingKey]: PlatformSettingValues[K] } = {
    ...DEFAULT_PLATFORM_SETTINGS,
  };
  for (const { key, value } of rows) {
    if (key === 'registration_mode' && (value === 'OPEN' || value === 'INVITE_ONLY')) {
      out.registration_mode = value;
    } else if (key === 'forbidden_terms' && isStringList(value)) {
      out.forbidden_terms = value;
    } else if (key === 'blocked_domains' && isStringList(value)) {
      out.blocked_domains = value;
    } else if (
      key === 'extraction_daily_limit' &&
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 0
    ) {
      out.extraction_daily_limit = value;
    }
  }
  return out;
}

/**
 * ADM-09 : réglages en mémoire, relus toutes les 30 secondes (une seule instance d'API en v1 :
 * une écriture est vue tout de suite par ce processus). Base indisponible : la dernière valeur
 * lue reste, à défaut les valeurs par défaut.
 */
@Injectable()
export class PrismaPlatformSettings
  extends PlatformSettings
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaPlatformSettings.name);
  private values: PlatformSettingValues = DEFAULT_PLATFORM_SETTINGS;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh(): Promise<void> {
    try {
      const rows = await this.prisma.platformSetting.findMany({
        select: { key: true, value: true },
      });
      this.values = parseSettings(rows);
    } catch {
      this.logger.warn('Réglages de plateforme illisibles : dernière valeur conservée');
    }
  }

  current(): PlatformSettingValues {
    return this.values;
  }

  async write<K extends PlatformSettingKey>(
    input: SettingWrite<K>,
  ): Promise<PlatformSettingValues[K]> {
    const before = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.platformSetting.findMany({ select: { key: true, value: true } });
      const previous = parseSettings(rows)[input.key];
      await tx.platformSetting.upsert({
        where: { key: input.key },
        create: {
          key: input.key,
          value: input.value as Prisma.InputJsonValue,
          updatedByAccountId: input.updatedBy,
        },
        update: {
          value: input.value as Prisma.InputJsonValue,
          updatedByAccountId: input.updatedBy,
        },
      });
      await appendAudit(tx, input.audit(previous));
      return previous;
    });
    await this.refresh();
    return before;
  }
}
