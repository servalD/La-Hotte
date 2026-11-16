import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { type Prisma } from '@prisma/client';
import { AppConfig } from '../../../platform/config/env';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { ErrorReporter } from '../../../platform/telemetry/error-reporter';
import {
  type CachedExtraction,
  ExtractionCache,
  type ExtractionJob,
  ExtractionQueue,
} from '../domain/extraction.ports';
import { FailStaleExtractions, RunExtraction } from '../application/extract-product.use-case';

/** EXT-35 : clé = URL normalisée ; valeur = données publiques validées de la page. */
@Injectable()
export class PrismaExtractionCache extends ExtractionCache {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async get(normalizedUrl: string, now: Date): Promise<CachedExtraction | null> {
    const row = await this.prisma.extractionCache.findUnique({ where: { normalizedUrl } });
    if (!row || row.expiresAt <= now) return null;
    return row.result as unknown as CachedExtraction;
  }

  async put(input: {
    id: string;
    normalizedUrl: string;
    value: CachedExtraction;
    expiresAt: Date;
  }): Promise<void> {
    const result = input.value as unknown as Prisma.InputJsonValue;
    await this.prisma.extractionCache.upsert({
      where: { normalizedUrl: input.normalizedUrl },
      create: {
        id: input.id,
        normalizedUrl: input.normalizedUrl,
        result,
        expiresAt: input.expiresAt,
      },
      update: { result, expiresAt: input.expiresAt },
    });
  }
}

/**
 * ADR 0016 : file dans le processus. Les tâches en cours sont attendues à l'arrêt propre ; un
 * arrêt brutal les perd, et le balayage de EXT-06 passe leurs fiches en `FAILED`. Une erreur
 * inattendue va à GlitchTip sans contenu (OBS-25) et la fiche passe en `FAILED`.
 */
@Injectable()
export class InProcessExtractionQueue
  extends ExtractionQueue
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(InProcessExtractionQueue.name);
  private readonly running = new Set<Promise<void>>();
  private sweeper: NodeJS.Timeout | null = null;
  private readonly enabled: boolean;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly errors: ErrorReporter,
    config: AppConfig,
  ) {
    super();
    this.enabled = config.env.NODE_ENV !== 'test';
  }

  enqueue(job: ExtractionJob): void {
    const run = this.moduleRef.get(RunExtraction, { strict: false });
    const task = (
      job.kind === 'link'
        ? run.link(job.productId, job.url)
        : run.photo(job.productId, job.imageKey)
    )
      .catch((error: unknown) => {
        this.logger.error({ err: error }, 'Extraction en échec');
        this.errors.report(error, { route: `task:extraction.${job.kind}` });
      })
      .finally(() => {
        this.running.delete(task);
      });
    this.running.add(task);
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    const sweep = () => {
      void this.moduleRef
        .get(FailStaleExtractions, { strict: false })
        .execute()
        .catch((error: unknown) => {
          this.errors.report(error, { route: 'task:extraction.sweep' });
        });
    };
    sweep();
    this.sweeper = setInterval(sweep, 60_000);
    this.sweeper.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    await Promise.allSettled([...this.running]);
  }
}
