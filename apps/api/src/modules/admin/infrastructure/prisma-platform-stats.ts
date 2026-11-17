import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { PlatformStatsReader, type RawStats, STATS_WINDOW_MS } from '../domain/platform-stats';

/** STA-02 : comptages seulement ; aucune ligne ni identifiant ne sort d'ici. */
@Injectable()
export class PrismaPlatformStats extends PlatformStatsReader {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async read(now: Date): Promise<RawStats> {
    const since = new Date(now.getTime() - STATS_WINDOW_MS);
    const [
      accountsTotal,
      activeAccounts30d,
      accountsCreated30d,
      listsCreated30d,
      catalogProducts,
      openReports,
      extractionsDone30d,
      extractionsFailed30d,
      median,
    ] = await Promise.all([
      this.prisma.account.count({ where: { status: 'ACTIVE' } }),
      this.prisma.account.count({ where: { status: 'ACTIVE', lastSignInAt: { gte: since } } }),
      this.prisma.account.count({ where: { createdAt: { gte: since } } }),
      this.prisma.list.count({ where: { createdAt: { gte: since } } }),
      this.prisma.product.count({ where: { shareLevel: 'GLOBAL', moderationStatus: 'APPROVED' } }),
      this.prisma.report.count({ where: { status: 'OPEN' } }),
      this.prisma.product.count({
        where: { extractionStatus: 'DONE', extractionStartedAt: { gte: since } },
      }),
      this.prisma.product.count({
        where: { extractionStatus: 'FAILED', extractionStartedAt: { gte: since } },
      }),
      this.prisma.$queryRaw<{ hours: number | null }[]>`
        SELECT percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM ("decided_at" - "created_at")) / 3600
        )::float8 AS hours
        FROM "report" WHERE "status" = 'DECIDED' AND "decided_at" >= ${since}`,
    ]);
    return {
      accountsTotal,
      activeAccounts30d,
      accountsCreated30d,
      listsCreated30d,
      catalogProducts,
      openReports,
      medianReportHours: median[0]?.hours ?? null,
      extractionsDone30d,
      extractionsFailed30d,
    };
  }
}

/** Double des tests : valeurs fixées par le banc. */
export class FixedPlatformStats extends PlatformStatsReader {
  raw: RawStats = {
    accountsTotal: 0,
    activeAccounts30d: 0,
    accountsCreated30d: 0,
    listsCreated30d: 0,
    catalogProducts: 0,
    openReports: 0,
    medianReportHours: null,
    extractionsDone30d: 0,
    extractionsFailed30d: 0,
  };

  read(): Promise<RawStats> {
    return Promise.resolve(this.raw);
  }
}
