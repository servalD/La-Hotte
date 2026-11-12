// @vitest-environment node
import * as Sentry from '@sentry/nextjs';
import { describe, expect, it } from 'vitest';
import { parseBrowserTelemetryEnv, parseServerTelemetryEnv } from './env';
import {
  buildClientSentryOptions,
  CLOSED_DATA_COLLECTION,
  MONITORING_TUNNEL,
} from './sentry-client-options';
import { buildServerSentryOptions } from './sentry-server-options';
import { sanitizeError } from './server-stack';

const DSN = 'http://public@127.0.0.1:1/1';
const MARKER = 'MARQUEUR-ALICE';

const client = buildClientSentryOptions({
  NEXT_PUBLIC_SENTRY_DSN: DSN,
  NEXT_PUBLIC_DEPLOY_ENVIRONMENT: 'preview',
  NEXT_PUBLIC_RELEASE: 'abc1234',
});
const server = buildServerSentryOptions({
  SENTRY_DSN: DSN,
  DEPLOY_ENVIRONMENT: 'preview',
  RELEASE: 'abc1234',
});

const EXPECTED_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 0,
};

function integrationNames(options: typeof client, defaults: { name: string }[]): string[] {
  const integrations = options.integrations;
  if (typeof integrations !== 'function') throw new Error('integrations doit être une fonction');
  return integrations(defaults as Parameters<typeof integrations>[0]).map((i) => i.name);
}

describe('options Sentry du navigateur (OBS-28, OBS-33)', () => {
  it('ferme chaque clé de dataCollection', () => {
    expect(client.dataCollection).toEqual(EXPECTED_DATA_COLLECTION);
    expect(client.dataCollection).toBe(CLOSED_DATA_COLLECTION);
  });

  it('passe par le relais de notre origine', () => {
    expect(client.tunnel).toBe(MONITORING_TUNNEL);
    expect(MONITORING_TUNNEL).toBe('/monitoring');
  });

  it('OBS-03 : erreurs seulement, ni traces ni replay', () => {
    expect(client.tracesSampleRate).toBeUndefined();
    expect(client.tracesSampler).toBeUndefined();
    const raw = client as Record<string, unknown>;
    expect(raw.replaysSessionSampleRate).toBeUndefined();
    expect(raw.replaysOnErrorSampleRate).toBeUndefined();
    const names = integrationNames(
      client,
      [
        'EventFilters',
        'FunctionToString',
        'ConversationId',
        'BrowserApiErrors',
        'Breadcrumbs',
        'Console',
        'GlobalHandlers',
        'LinkedErrors',
        'Dedupe',
        'HttpContext',
        'CultureContext',
        'BrowserSession',
        'BrowserTracing',
        'Replay',
        'NextjsClientStackFrameNormalization',
      ].map((name) => ({ name })),
    );
    expect(names).toEqual([
      'EventFilters',
      'FunctionToString',
      'BrowserApiErrors',
      'GlobalHandlers',
      'LinkedErrors',
      'Dedupe',
      'NextjsClientStackFrameNormalization',
    ]);
  });

  it('fils d’Ariane et autres flux fermés', () => {
    expect(client.maxBreadcrumbs).toBe(0);
    expect(client.sendClientReports).toBe(false);
    expect(client.debug).toBe(false);
  });
});

describe('options Sentry du serveur Next (OBS-12, OBS-28, OBS-45)', () => {
  it('ferme chaque clé de dataCollection', () => {
    expect(server.dataCollection).toBe(CLOSED_DATA_COLLECTION);
  });

  it('Sentry ne crée aucun span', () => {
    expect(server.tracesSampleRate).toBeUndefined();
    expect((server as Record<string, unknown>).enableOpenTelemetrySetup).toBe(false);
  });

  it('retire les intégrations qui capturent du contenu ou l’erreur d’origine', () => {
    const names = integrationNames(server, Sentry.getDefaultIntegrations({}));
    for (const removed of [
      'Console',
      'Http',
      'NodeFetch',
      'RequestData',
      'LocalVariablesAsync',
      'ContextLines',
      'Context',
      'Modules',
      'ChildProcess',
      'NodeSystemError',
      'OnUncaughtException',
      'OnUnhandledRejection',
    ]) {
      expect(names).not.toContain(removed);
    }
    expect(names).toContain('OpenTelemetry');
  });

  it('l’analyseur de pile ne voit jamais les lignes du message', () => {
    const error = new TypeError(`ligne 1\nReserve par ${MARKER} at /cadeaux/velo:12:3`);
    const parser = server.stackParser;
    if (typeof parser !== 'function') throw new Error('stackParser doit être une fonction');
    const frames = JSON.stringify(parser(error.stack ?? ''));
    expect(frames).not.toContain(MARKER);
    expect(frames).not.toContain('cadeaux');
  });

  it('sanitizeError ne garde ni message ni propriétés', () => {
    const error = Object.assign(new Error(`titre ${MARKER}`), {
      code: 'ECONNREFUSED',
      meta: { query: MARKER },
      cause: new RangeError(MARKER),
    });
    const clean = sanitizeError(error);
    expect(clean.message).toBe('');
    const seen = JSON.stringify({
      own: Object.fromEntries(Object.entries(clean)),
      stack: clean.stack,
      cause: (clean.cause as Error).stack,
    });
    expect(seen).not.toContain(MARKER);
    expect((clean as Error & { code?: string }).code).toBe('ECONNREFUSED');
    expect((clean.cause as Error).name).toBe('RangeError');
  });
});

describe('variables de télémétrie du web (OBS-47)', () => {
  it('toutes facultatives ; vide vaut absente', () => {
    expect(parseServerTelemetryEnv({ SENTRY_DSN: '' }).SENTRY_DSN).toBeUndefined();
    expect(parseBrowserTelemetryEnv({}).NEXT_PUBLIC_DEPLOY_ENVIRONMENT).toBe('development');
  });

  it('nomme la variable invalide, jamais sa valeur', () => {
    expect(() =>
      parseBrowserTelemetryEnv({ NEXT_PUBLIC_SENTRY_DSN: `pas-une-url-${MARKER}` }),
    ).toThrow(/NEXT_PUBLIC_SENTRY_DSN/);
    try {
      parseServerTelemetryEnv({ RELEASE: MARKER });
    } catch (error) {
      expect(String(error)).not.toContain(MARKER);
    }
  });
});
