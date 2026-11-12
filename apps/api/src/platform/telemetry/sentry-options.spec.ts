import * as Sentry from '@sentry/nestjs';
import { buildSentryOptions, CLOSED_DATA_COLLECTION } from './sentry-options';

const options = buildSentryOptions({
  SENTRY_DSN: 'http://public@127.0.0.1:1/1',
  DEPLOY_ENVIRONMENT: 'preview',
  RELEASE: 'abc1234',
});

describe('options Sentry (OBS-28)', () => {
  it('ferme chaque clé de dataCollection', () => {
    expect(options.dataCollection).toEqual({
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
    });
    expect(options.dataCollection).toBe(CLOSED_DATA_COLLECTION);
  });

  it('OBS-12 : Sentry ne crée aucun span', () => {
    expect(options.tracesSampleRate).toBeUndefined();
    expect(options.tracesSampler).toBeUndefined();
    expect(options.enableOpenTelemetrySetup).toBe(false);
  });

  it('retire les intégrations qui capturent du contenu, ajoute OpenTelemetry', () => {
    const defaults = Sentry.getDefaultIntegrations({}) ?? [];
    const integrations = options.integrations;
    if (typeof integrations !== 'function') throw new Error('integrations doit être une fonction');
    const names = integrations(defaults).map((integration) => integration.name);

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
    ]) {
      expect(names).not.toContain(removed);
    }
    expect(names).toContain('OpenTelemetry');
  });

  // Revue de sécurité du 2026-11-12 : une exception non gérée arrive au SDK avec sa pile
  // d'origine ; l'analyseur prenait la ligne du message pour un cadre avec numéro de ligne.
  it('OBS-45 : l’analyseur de pile ne voit jamais les lignes du message', () => {
    const error = new TypeError('ligne 1\nReserve par MARQUEUR-ALICE at /cadeaux/velo:12:3');
    const parser = options.stackParser;
    if (typeof parser !== 'function') throw new Error('stackParser doit être une fonction');
    const frames = parser(error.stack ?? '');
    expect(frames.length).toBeGreaterThan(0);
    expect(JSON.stringify(frames)).not.toContain('MARQUEUR-ALICE');
    expect(JSON.stringify(frames)).not.toContain('cadeaux');
  });

  // Contre-revue du 2026-11-12 : ces intégrations transmettent l'erreur d'origine au SDK et,
  // après une première erreur fatale, écrivent la suivante brute sur la sortie d'erreur.
  it('OBS-45 : exceptions et rejets non gérés hors des intégrations du SDK (voir fatal.ts)', () => {
    const integrations = options.integrations;
    if (typeof integrations !== 'function') throw new Error('integrations doit être une fonction');
    const names = integrations(Sentry.getDefaultIntegrations({}) ?? []).map((i) => i.name);
    expect(names).not.toContain('OnUnhandledRejection');
    expect(names).not.toContain('OnUncaughtException');
  });

  it('flux de journaux et de métriques fermés', () => {
    expect(options.beforeSendLog?.({ level: 'info', message: 'x' })).toBeNull();
  });

  it('aucun fil d’Ariane', () => {
    expect(options.maxBreadcrumbs).toBe(0);
    expect(options.beforeBreadcrumb?.({ message: 'x' }, undefined)).toBeNull();
  });

  it('beforeSend nettoie l’événement', () => {
    const sent = options.beforeSend?.(
      { type: undefined, message: 'secret', user: { email: 'a@b.c' } },
      {},
    );
    expect(sent).toEqual({ type: undefined });
  });
});
