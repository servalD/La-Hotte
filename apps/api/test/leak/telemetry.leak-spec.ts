// Premier import : télémétrie démarrée avant l'application, comme `instrument.ts` (OBS-12).
import { leakTelemetryEnv } from './start-telemetry';
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { LogDestination } from '../../src/platform/logging/logging.module';
import { shutdownTelemetry } from '../../src/platform/telemetry/telemetry';
import { CAPTURE_PROBE, captureOutput, type OutputCapture } from './capture-output';
import { describeHandedError } from './describe-handed-error.mjs';
import { LeakRoutesController } from './leak-routes.controller';
import { ALLOWED_EVENT_KEYS, AMOUNT_MARKER, envelopeEvents, findMarker, MARKER } from './markers';
import { type Channel, fetchRecords, type ReceivedRecord, resetRecords } from './receivers';

/**
 * OBS-26, volet A : des marqueurs entrent par toutes les portes d'une requête (corps, chemin,
 * chaîne de requête, en-têtes, erreurs, paramètres SQL) ; on vérifie qu'ils ne sortent par
 * aucun canal d'observation, tel que les exporteurs l'envoient réellement. Chaque canal doit
 * aussi être non vide : une instrumentation qui ne s'applique pas ne donne pas un faux vert.
 */

const receiverUrl = inject('receiverUrl');
const logLines: string[] = [];
const handedToSdk: string[] = [];
let records: ReceivedRecord[] = [];
let output: OutputCapture = { text: () => '', restore: () => undefined };

const capturingDestination: LogDestination = {
  write: (line: string) => {
    logLines.push(line);
  },
};

/** En-têtes porteurs de marqueur sur chaque requête. */
const markedHeaders = {
  Authorization: `Bearer ${MARKER}`,
  Cookie: `session=${MARKER}`,
  'Idempotency-Key': MARKER,
  'User-Agent': `navigateur ${MARKER}`,
  'X-Request-Id': MARKER,
  // Contexte de trace venu du client : `tracestate` et `baggage` sont du texte libre.
  traceparent: `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`,
  tracestate: `client=${MARKER}`,
  baggage: `panier=${MARKER}`,
};

function bodies(channel: Channel): string {
  return records
    .filter((record) => record.channel === channel)
    .map((record) => record.body)
    .join('\n');
}

type SentEvent = Record<string, unknown> & {
  exception?: { values?: Array<{ type?: string }> };
  contexts?: { trace?: { trace_id?: string } };
};

function errorEvents(): SentEvent[] {
  return records
    .filter((record) => record.channel === 'errors')
    .flatMap((record) => envelopeEvents(record.body) as SentEvent[]);
}

beforeAll(async () => {
  // Récepteurs partagés entre fichiers : on ne garde que ce que ce fichier produit.
  await resetRecords(receiverUrl);

  // Objet exact transmis à `captureException` : `trustedStack` et `beforeSend` rattrapent
  // derrière, l'export seul ne verrait pas `sanitizeError` disparaître.
  const client = Sentry.getClient();
  if (!client) throw new Error('Sentry non démarré');
  client.on('beforeSendEvent', (_event, hint) => {
    handedToSdk.push(describeHandedError(hint?.originalException));
  });

  // Depuis la compilation du module : les journaux de Nest émis avant `useLogger` comptent aussi.
  output = captureOutput();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [LeakRoutesController],
  })
    .overrideProvider(LogDestination)
    .useValue(capturingDestination)
    .compile();
  const app: INestApplication = moduleRef.createNestApplication({ bufferLogs: true });
  try {
    configureApp(app);
    await app.init();
    await playScenario(app);
  } finally {
    // Même en cas d'échec : sinon Prisma, Redis et les exporteurs retiennent le processus et le
    // job de CI attend son délai au lieu d'échouer.
    // `close` appelle `shutdownTelemetry` (TelemetryShutdown) : spans, métriques et Sentry vidés.
    await app.close();
    await shutdownTelemetry();
    output.restore();
  }
  records = await fetchRecords(receiverUrl);
}, 60_000);

afterAll(() => {
  // Si la compilation du module a échoué avant le `try`.
  output.restore();
});

async function playScenario(app: INestApplication): Promise<void> {
  const http = request(app.getHttpServer());
  const marker = { marker: MARKER };

  // Contenu métier : titre, commentaire, URL d'article, montant (champs inconnus refusés, 400).
  await http
    .post(`/api/v1/example-items?url=${MARKER}`)
    .set(markedHeaders)
    .send({
      title: `Vélo ${MARKER}`,
      comment: `Pour ${MARKER}`,
      url: `https://boutique.example/velo?ref=${MARKER}`,
      amount: AMOUNT_MARKER,
    })
    .expect(400);

  // Création réussie : le titre passe par Prisma (paramètre SQL), puis relecture.
  const created = await http
    .post('/api/v1/example-items')
    .set(markedHeaders)
    .send({ title: `Vélo ${MARKER}` })
    .expect(201);
  await http
    .get(`/api/v1/example-items/${created.body.id as string}`)
    .set(markedHeaders)
    .expect(200);

  // Chemin résolu porteur de marqueur, route trouvée (OBS-21) puis route inconnue.
  await http.get(`/api/v1/example-items/${MARKER}?url=${MARKER}`).set(markedHeaders).expect(400);
  await http.get(`/api/v1/${MARKER}/${AMOUNT_MARKER}`).set(markedHeaders).expect(404);

  // Erreur métier, comptée par code (OBS-25).
  await http.get(`/api/v1/example-items/${randomUUID()}`).set(markedHeaders).expect(404);

  // JSON invalide : le message de l'analyseur cite le corps reçu.
  await http
    .post('/api/v1/example-items')
    .set(markedHeaders)
    .set('Content-Type', 'application/json')
    .send(`{"title": "${MARKER}`)
    .expect(400);

  // Erreurs inattendues (OBS-25, OBS-45), SQL (OBS-23), métrique (OBS-20).
  await http.post('/api/v1/_leak/boom').set(markedHeaders).send(marker).expect(500);
  await http.post('/api/v1/_leak/query').set(markedHeaders).send(marker).expect(500);
  await http.post('/api/v1/_leak/query-ok').set(markedHeaders).send(marker).expect(200);
  await http.post('/api/v1/_leak/metric').set(markedHeaders).send(marker).expect(204);
}

describe('OBS-26 non-fuite de la télémétrie, application montée', () => {
  it('le test parle bien aux faux récepteurs', () => {
    expect(leakTelemetryEnv.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(receiverUrl);
  });

  it('journaux (OBS-01, OBS-21, OBS-45) : gabarit de route, erreur sans message', () => {
    const lines = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const routes = lines.map((line) => line.route);
    expect(routes).toContain('/api/v1/example-items/:id');
    expect(routes).toContain('/api/v1/_leak/boom');
    const errTypes = lines.map((line) => (line.err as { type?: string } | undefined)?.type);
    expect(errTypes).toContain('TypeError');
    expect(lines.some((line) => typeof line.trace_id === 'string')).toBe(true);

    expect(findMarker(logLines.join(''))).toBeUndefined();
  });

  it('sortie du processus hors pino (console, stdout, stderr) : rien du marqueur', () => {
    const text = output.text();
    for (const channel of ['stdout', 'stderr', 'console']) {
      expect(text).toContain(`${CAPTURE_PROBE}:${channel}`);
    }
    expect(findMarker(text)).toBeUndefined();
  });

  it('spans (OBS-22, OBS-23, OBS-29) : requêtes HTTP et Prisma tracées, sans contenu', () => {
    const traces = bodies('traces');
    expect(traces).toContain('/api/v1/_leak/boom');
    expect(traces).toContain('/api/v1/example-items/:id');
    expect(traces).toMatch(/prisma:engine:db_query/);

    expect(findMarker(traces)).toBeUndefined();
  });

  it('métriques (OBS-20) : compteurs présents, étiquettes interdites retirées', () => {
    const metrics = bodies('metrics');
    expect(metrics).toContain('wishlist.domain_errors');
    expect(metrics).toContain('wishlist.leak_test');
    expect(metrics).toContain('LEAK_TEST');

    expect(findMarker(metrics)).toBeUndefined();
  });

  it('SentryErrorReporter (OBS-45) : le SDK ne reçoit qu’une copie nettoyée', () => {
    expect(handedToSdk).toHaveLength(2);
    expect(findMarker(handedToSdk.join('\n'))).toBeUndefined();
  });

  it('événements d’erreur (OBS-25, OBS-28, OBS-45) : un par 5xx, rien de la requête', () => {
    const events = errorEvents();
    // Une par 5xx, et ce sont bien elles : la route `boom` et la requête SQL refusée. L'exception
    // principale est la dernière de `values` (les causes la précèdent).
    const mainTypes = events.map((event) => event.exception?.values?.at(-1)?.type).sort();
    expect(mainTypes).toEqual(['PrismaClientKnownRequestError', 'TypeError']);
    // `beforeSend` reconstruit l'événement en liste blanche : ni requête, ni utilisateur, ni
    // `extra`, ni nom de machine, ni transaction.
    const keys = new Set(events.flatMap((event) => Object.keys(event)));
    expect([...keys].filter((key) => !ALLOWED_EVENT_KEYS.has(key))).toEqual([]);

    expect(findMarker(bodies('errors'))).toBeUndefined();
  });

  it('OBS-12 : l’événement d’erreur porte le trace_id d’une trace exportée', () => {
    const traces = bodies('traces');
    const traceIds = errorEvents().map((event) => event.contexts?.trace?.trace_id);
    expect(traceIds.length).toBeGreaterThan(0);
    for (const traceId of traceIds) {
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(traces).toContain(traceId);
    }
  });

  it('aucun autre canal, et aucun marqueur nulle part', () => {
    expect(
      records.filter((record) => !['traces', 'metrics', 'errors'].includes(record.channel)),
    ).toEqual([]);
    expect(findMarker(records.map((record) => record.body).join('\n'))).toBeUndefined();
  });
});
