import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { context, TraceFlags, trace } from '@opentelemetry/api';
import { TraceState } from '@opentelemetry/core';
import { type CounterName, type MetricAttributes, Metrics } from '../../src/shared/domain';
import { AMOUNT_MARKER } from './markers';
import { PrismaService } from '../../src/platform/prisma/prisma.service';

/**
 * `http` en CommonJS, comme dans l'API compilée : l'instrumentation modifie l'objet exporté par
 * `require`. Un import ESM (`import { get } from 'node:http'`, transformé par Vitest) recevrait
 * la fonction d'origine, non instrumentée, et le test ne verrait aucune propagation.
 */
const http = createRequire(__filename)('node:http') as typeof import('node:http');

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
   * Requête sortante vers un tiers (ici le faux récepteur) : le contexte de trace propagé ne
   * doit rien porter du client (`tracestate`, `baggage`), revue de sécurité du 2026-11-12.
   * `node:http`, instrumenté comme le sera tout client sortant (`fetch` ne l'est pas ici).
   */
  @Post('outbound')
  @HttpCode(204)
  async outbound(): Promise<void> {
    // `localhost` et non `127.0.0.1` : les envois vers GlitchTip (même hôte et port que le faux
    // récepteur) ne sont pas tracés, donc sans `traceparent` (`isGlitchTip`, telemetry.ts).
    const target = new URL('/_outbound', process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
    target.hostname = 'localhost';
    await new Promise<void>((resolve, reject) => {
      http
        .get(target, (response) => {
          response.resume();
          response.on('end', resolve);
        })
        .on('error', reject);
    });
  }

  /**
   * Span dont le parent et un lien portent un `traceState` arrivé par un autre chemin que
   * l'extraction (échantillonneur, lien construit à la main) : seul `scrubSpanContext` l'arrête.
   * Sans cette route, retirer cette seconde barrière laisserait le test vert (revue du
   * 2026-11-12), le propagateur retirant déjà le `tracestate` du client.
   */
  @Post('span-context')
  @HttpCode(204)
  spanContext(@Body() body: LeakBody): void {
    const marked = {
      traceId: randomBytes(16).toString('hex'),
      spanId: randomBytes(8).toString('hex'),
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
      traceState: new TraceState(`client=${body.marker}`),
    };
    trace
      .getTracer('leak-test')
      .startSpan(
        'leak-span-context',
        { links: [{ context: marked }] },
        trace.setSpanContext(context.active(), marked),
      )
      .end();
  }

  /**
   * Port `Metrics` (OBS-02, OBS-20), en contournant son typage comme le ferait une erreur de
   * programmation : clés de la liste noire des spans, clé libre et montants que seule une liste
   * blanche arrête, texte libre sous les clés permises, nom de métrique construit à partir d'un
   * contenu, montant mesuré sous un nom hors liste. Le compteur valide doit, lui, sortir avec son
   * `code` et son `kind`.
   */
  @Post('metric')
  @HttpCode(204)
  metric(@Body() body: LeakBody): void {
    this.metrics.increment('wishlist.domain_errors', {
      code: 'LEAK_TEST',
      kind: 'conflict',
      status: AMOUNT_MARKER,
      montant: AMOUNT_MARKER,
      'url.full': `https://boutique.example/${body.marker}`,
      'http.request.header.cookie': body.marker,
      'db.query.text': `SELECT ${body.marker}`,
      liste: body.marker,
      'wishlist.titre': `Vélo ${body.marker}`,
    } as MetricAttributes);
    this.metrics.increment('wishlist.domain_errors', {
      code: `Vélo ${body.marker}`,
      kind: body.marker,
    } as unknown as MetricAttributes);
    this.metrics.increment(`wishlist.liste_${body.marker}` as CounterName);
    this.metrics.record('wishlist.part' as never, AMOUNT_MARKER);
  }
}
