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
import { RedisService } from '../../src/platform/redis/redis.service';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { shutdownTelemetry } from '../../src/platform/telemetry/telemetry';
import { createAccountWithProfile, signIn } from '../support/sign-in';
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
/**
 * Secrets de session (ADR 0013, « Télémétrie ») : jeton, hash, jeton CSRF de session et de
 * pré-session, identifiant de pré-session. Aucun ne doit sortir par un canal d'observation.
 */
const sessionSecrets: Record<string, string> = {};

const capturingDestination: LogDestination = {
  write: (line: string) => {
    logLines.push(line);
  },
};

const CLIENT_TRACE_ID = randomBytes(16).toString('hex');

/** En-têtes porteurs de marqueur sur chaque requête. */
const markedHeaders = {
  Authorization: `Bearer ${MARKER}`,
  Cookie: `session=${MARKER}`,
  'Idempotency-Key': MARKER,
  'User-Agent': `navigateur ${MARKER}`,
  'X-Request-Id': MARKER,
  // Contexte de trace venu du client : `tracestate` et `baggage` sont du texte libre ; les clés
  // `sentry-*` du `baggage` et `sentry-trace` iraient dans l'enveloppe si le propagateur de
  // Sentry était un jour actif.
  traceparent: `00-${CLIENT_TRACE_ID}-${randomBytes(8).toString('hex')}-01`,
  tracestate: `client=${MARKER}`,
  baggage: `panier=${MARKER},sentry-transaction=${MARKER},sentry-release=${MARKER},sentry-environment=${MARKER}`,
  'sentry-trace': `${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-1`,
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

  let app: INestApplication | undefined;
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [LeakRoutesController],
    })
      .overrideProvider(LogDestination)
      .useValue(capturingDestination)
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    await playScenario(app);
  } finally {
    // Même en cas d'échec, compilation comprise : sinon Prisma, Redis et les exporteurs
    // retiennent le processus et le job de CI attend son délai au lieu d'échouer.
    // `close` appelle `shutdownTelemetry` (TelemetryShutdown) : spans, métriques et Sentry vidés.
    await app?.close();
    await shutdownTelemetry();
    output.restore();
  }
  records = await fetchRecords(receiverUrl);
}, 60_000);

async function playScenario(app: INestApplication): Promise<void> {
  const http = request(app.getHttpServer());
  const marker = { marker: MARKER };

  // Session réelle (PostgreSQL et Redis) : chaque requête porte jeton, cookie et jeton CSRF.
  const user = await signIn(app, await createAccountWithProfile(app.get(PrismaService)));
  sessionSecrets.token = user.token;
  sessionSecrets.tokenHash = user.tokenHash;
  sessionSecrets.csrf = user.csrf;
  const authenticated = {
    ...markedHeaders,
    Cookie: `${user.cookie}; session=${MARKER}`,
    'X-CSRF-Token': user.csrf,
    Origin: 'http://localhost:3000',
  };

  // Pré-session (GET /session public) : identifiant et jeton CSRF de pré-session.
  const pre = await http.get('/api/v1/session').set(markedHeaders).expect(200);
  sessionSecrets.presessionCsrf = pre.body.csrfToken as string;
  const presessionCookie = ([] as string[])
    .concat((pre.headers['set-cookie'] as unknown as string[] | undefined) ?? [])
    .find((cookie) => cookie.startsWith('__Host-lh_presession='));
  sessionSecrets.presessionId = decodeURIComponent(
    presessionCookie?.split(';')[0]?.split('=')[1] ?? '',
  );

  // Session lue, puis cache perdu : réhydratation par script Lua (arguments jamais exportés).
  await http.get('/api/v1/session').set(authenticated).expect(200);
  await app.get(RedisService).client.del(`sess:${user.tokenHash}`);
  await http.get('/api/v1/session').set(authenticated).expect(200);

  // CSRF refusé (jeton forgé porteur du marqueur) : écrit au journal de sécurité (SQL paramétré).
  await http
    .post('/api/v1/_leak/query-ok')
    .set({ ...authenticated, 'X-CSRF-Token': MARKER })
    .send(marker)
    .expect(403);

  // Contenu métier : titre, commentaire, URL d'article, montant (champs inconnus refusés, 400).
  await http
    .post(`/api/v1/example-items?url=${MARKER}`)
    .set(authenticated)
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
    .set(authenticated)
    .send({ title: `Vélo ${MARKER}` })
    .expect(201);
  await http
    .get(`/api/v1/example-items/${created.body.id as string}`)
    .set(authenticated)
    .expect(200);

  // Chemin résolu porteur de marqueur, route trouvée (OBS-21) puis route inconnue.
  await http.get(`/api/v1/example-items/${MARKER}?url=${MARKER}`).set(authenticated).expect(400);
  await http.get(`/api/v1/${MARKER}/${AMOUNT_MARKER}`).set(authenticated).expect(404);

  // Erreur métier, comptée par code (OBS-25).
  await http.get(`/api/v1/example-items/${randomUUID()}`).set(authenticated).expect(404);

  // JSON invalide : le message de l'analyseur cite le corps reçu.
  await http
    .post('/api/v1/example-items')
    .set(authenticated)
    .set('Content-Type', 'application/json')
    .send(`{"title": "${MARKER}`)
    .expect(400);

  // Erreurs inattendues (OBS-25, OBS-45), SQL (OBS-23), métrique (OBS-20).
  await http.post('/api/v1/_leak/boom').set(authenticated).send(marker).expect(500);
  await http.post('/api/v1/_leak/query').set(authenticated).send(marker).expect(500);
  await http.post('/api/v1/_leak/query-ok').set(authenticated).send(marker).expect(200);
  await http.post('/api/v1/_leak/metric').set(authenticated).send(marker).expect(204);

  // `traceState` posé hors extraction, sur le parent et un lien (seconde barrière).
  await http.post('/api/v1/_leak/span-context').set(authenticated).send(marker).expect(204);

  // Commandes Redis porteuses du marqueur (clés, arguments de script).
  await http.post('/api/v1/_leak/redis').set(authenticated).send(marker).expect(204);

  // Appel sortant vers un tiers, dans le contexte de trace venu du client.
  await http.post('/api/v1/_leak/outbound').set(authenticated).expect(204);
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
    expect(traces).toContain('leak-span-context');

    expect(findMarker(traces)).toBeUndefined();
  });

  it('métriques (OBS-20) : compteurs présents, étiquettes interdites retirées', () => {
    const metrics = bodies('metrics');
    expect(metrics).toContain('wishlist.domain_errors');
    expect(metrics).toContain('LEAK_TEST');
    expect(metrics).toContain('"conflict"');
    // La liste blanche laisse passer les étiquettes de l'instrumentation HTTP (gabarit de route).
    expect(metrics).toContain('http.server.request.duration');
    expect(metrics).toContain('/api/v1/example-items/:id');
    // Ni clé libre, ni nom hors liste, ni hôte d'un appel sortant (`server.address`, posé par la
    // métrique client de l'instrumentation HTTP).
    expect(metrics).not.toContain('"liste"');
    expect(metrics).not.toContain('wishlist.part');
    expect(metrics).not.toContain('wishlist.liste_');
    expect(metrics).not.toContain('server.address');

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

  it('appel sortant (OBS-29) : traceparent propagé, rien du client (tracestate, baggage)', () => {
    const outbound = records.filter((record) => record.channel === 'outbound');
    expect(outbound).toHaveLength(1);
    const headers = JSON.parse(outbound[0]?.body ?? '{}') as Record<string, string>;
    // Même trace que le client (corrélation), nouveau span parent.
    expect(headers.traceparent).toMatch(new RegExp(`^00-${CLIENT_TRACE_ID}-[0-9a-f]{16}-01$`));
    expect(headers).not.toHaveProperty('tracestate');
    expect(headers).not.toHaveProperty('baggage');
    expect(headers).not.toHaveProperty('sentry-trace');
    expect(findMarker(outbound[0]?.body ?? '')).toBeUndefined();
  });

  it('ADR 0013 : jeton, hash, cookies, X-CSRF-Token et pré-session absents de toute sortie', () => {
    expect(Object.keys(sessionSecrets).sort()).toEqual(
      ['csrf', 'presessionCsrf', 'presessionId', 'token', 'tokenHash'].sort(),
    );
    const everything = [
      logLines.join(''),
      output.text(),
      handedToSdk.join('\n'),
      records.map((record) => record.body).join('\n'),
    ].join('\n');
    for (const [name, secret] of Object.entries(sessionSecrets)) {
      expect(secret.length).toBeGreaterThan(20);
      expect({ name, leaked: everything.includes(secret) }).toEqual({ name, leaked: false });
    }
  });

  it('ADR 0013, OBS-23 : commandes Redis tracées sans clé ni argument (sérialiseur de telemetry.ts, puis scrub)', () => {
    const traces = bodies('traces');
    // Spans `mget`, `eval` et `set` présents : l'instrumentation s'applique (pas de faux vert).
    for (const command of ['mget', 'eval', 'set']) {
      expect(traces).toContain(`"stringValue":"${command}"`);
    }
    expect(traces).not.toContain('sess:');
    expect(traces).not.toContain('sess-revoked:');
  });

  it('aucun autre canal, et aucun marqueur nulle part', () => {
    expect(
      records.filter(
        (record) => !['traces', 'metrics', 'errors', 'outbound'].includes(record.channel),
      ),
    ).toEqual([]);
    expect(findMarker(records.map((record) => record.body).join('\n'))).toBeUndefined();
  });
});
