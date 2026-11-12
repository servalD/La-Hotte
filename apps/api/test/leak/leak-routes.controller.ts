import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Metrics } from '../../src/shared/domain';
import { PrismaService } from '../../src/platform/prisma/prisma.service';

/** Corps libre : ces routes n'existent qu'en test et reçoivent les marqueurs tels quels. */
type LeakBody = { marker: string };

/**
 * Routes de test du volet A d'OBS-26, montées seulement par le test. Elles font sortir le
 * marqueur par les chemins que le code métier empruntera : erreur inattendue (5xx), requête SQL
 * paramétrée qui échoue en citant sa valeur, requête qui réussit, métrique.
 */
@Controller('_leak')
export class LeakRoutesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: Metrics,
  ) {}

  /** Erreur inattendue : message multiligne avec un faux cadre, propriétés et cause (OBS-45). */
  @Post('boom')
  boom(@Body() body: LeakBody): never {
    throw Object.assign(
      new TypeError(`Échec pour ${body.marker}\n    at reserve (/cadeaux/${body.marker}:12:3)`),
      { query: `SELECT ${body.marker}`, meta: { target: body.marker } },
      { cause: new Error(`cause ${body.marker}`) },
    );
  }

  /** PostgreSQL refuse la conversion et cite la valeur (22P02) ; Prisma la reprend (OBS-23). */
  @Post('query')
  async failingQuery(@Body() body: LeakBody): Promise<unknown> {
    return this.prisma.$queryRaw`SELECT ${body.marker}::int AS value`;
  }

  /** Requête qui réussit : sa valeur ne doit apparaître dans aucun span (OBS-23). */
  @Post('query-ok')
  @HttpCode(200)
  async query(@Body() body: LeakBody): Promise<{ ok: true }> {
    await this.prisma.$queryRaw`SELECT ${body.marker}::text AS value`;
    return { ok: true };
  }

  /**
   * Étiquettes interdites passées au port `Metrics` (OBS-20). Seulement des clés de la liste
   * noire : la liste blanche des étiquettes est une suite de revue encore ouverte.
   */
  @Post('metric')
  @HttpCode(204)
  metric(@Body() body: LeakBody): void {
    this.metrics.increment('wishlist.leak_test', {
      code: 'LEAK_TEST',
      'url.full': `https://boutique.example/${body.marker}`,
      'http.request.header.cookie': body.marker,
      'db.query.text': `SELECT ${body.marker}`,
    });
  }
}
