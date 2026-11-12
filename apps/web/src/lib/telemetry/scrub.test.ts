// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TraceState } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace';
import {
  FORBIDDEN_ATTRIBUTE_KEYS,
  FORBIDDEN_ATTRIBUTE_PREFIXES,
  isTrustedBrowserFrame,
  scrubAttributes,
  scrubSpan,
  scrubSpanName,
} from './scrub';

describe('noms de spans de Next (OBS-21, OBS-24)', () => {
  it.each([
    [
      'GET /items/abc?url=https://cadeau.example/velo',
      { 'next.route': '/items/[id]' },
      'GET /items/[id]',
    ],
    ['GET /Velo-pour-Marie', {}, 'GET (route inconnue)'],
    ['POST /monitoring', { 'http.route': '/monitoring' }, 'POST /monitoring'],
    ['fetch GET http://api:4000/api/items/1?titre=Velo', {}, 'fetch GET http://api:4000'],
    ['render route (app) /items/[id]', {}, 'render route (app) /items/[id]'],
    ['resolve page components ?q=Velo#x', {}, 'resolve page components '],
  ])('%s → %s', (name, attributes, expected) => {
    expect(scrubSpanName(name, attributes)).toBe(expected);
  });
});

describe('attributs de spans (OBS-29)', () => {
  it('retire les attributs interdits, dont next.span_name', () => {
    expect(
      scrubAttributes({
        'next.span_name': 'GET /items/abc?url=x',
        'http.target': '/items/abc?url=x',
        'http.url': 'http://localhost/items',
        'http.request.header.cookie': 'session',
        'next.route': '/items/[id]',
        'http.method': 'GET',
      }),
    ).toEqual({ 'next.route': '/items/[id]', 'http.method': 'GET' });
  });

  // Trois copies de la liste : API, web, collecteur (seconde barrière). Elles restent alignées.
  it('même liste que l’API, plus les clés propres à Next', () => {
    const apiScrub = readFileSync(
      fileURLToPath(new URL('../../../../api/src/platform/telemetry/scrub.ts', import.meta.url)),
      'utf8',
    ).replace(/^\s*\/\/.*$/gm, '');
    const block = (name: string) =>
      /(?:Set\(\[|= \[)([\s\S]*?)\]/.exec(apiScrub.slice(apiScrub.indexOf(name)))?.[1] ?? '';
    const quoted = (text: string) => [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]);

    const apiKeys = quoted(block('FORBIDDEN_ATTRIBUTE_KEYS'));
    const apiPrefixes = quoted(block('FORBIDDEN_ATTRIBUTE_PREFIXES'));
    expect(apiKeys.length).toBeGreaterThan(10);
    expect([...FORBIDDEN_ATTRIBUTE_KEYS].filter((key) => !key.startsWith('next.')).sort()).toEqual(
      [...apiKeys].sort(),
    );
    expect([...FORBIDDEN_ATTRIBUTE_PREFIXES].sort()).toEqual([...apiPrefixes].sort());
  });

  it('le collecteur retire aussi next.span_name et nettoie les noms de spans', () => {
    const collector = readFileSync(
      fileURLToPath(
        new URL('../../../../../ops/observability/otel-collector.yaml', import.meta.url),
      ),
      'utf8',
    );
    expect(collector).toContain('next\\.span_name');
    expect(collector).toContain('replace_pattern(span.name');
  });
});

describe('spans nettoyés à l’export (OBS-29, OBS-21)', () => {
  const MARKER = 'MARQUEUR-VELO-MARIE';
  const withState = (spanId: string) => ({
    traceId: '0af7651916cd43dd8448eb211c80319c',
    spanId,
    traceFlags: 1,
    traceState: { serialize: () => `k=${MARKER}` } as unknown as TraceState,
  });

  it('retire événements exception, message de statut, traceState, attributs et chemin', () => {
    const span = {
      name: `GET /items/abc?url=${MARKER}`,
      kind: 1,
      spanContext: () => withState('b7ad6b7169203331'),
      parentSpanContext: withState('a7ad6b7169203331'),
      startTime: [0, 0],
      endTime: [0, 1],
      status: { code: 2, message: `échec ${MARKER}` },
      attributes: {
        'next.span_name': `GET /items/abc?url=${MARKER}`,
        'http.target': `/items/abc?url=${MARKER}`,
        'next.route': '/items/[id]',
      },
      links: [{ context: withState('c7ad6b7169203331'), attributes: { 'url.full': MARKER } }],
      events: [
        { name: 'exception', time: [0, 0], attributes: { 'exception.message': MARKER } },
        { name: 'retry', time: [0, 0], attributes: { 'http.url': MARKER, attempt: 1 } },
      ],
      duration: [0, 1],
      ended: true,
      resource: { attributes: {} },
      instrumentationScope: { name: 'next.js' },
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    } as unknown as ReadableSpan;

    const clean = scrubSpan(span);
    const seen = JSON.stringify({
      ...clean,
      spanContext: clean.spanContext(),
      resource: undefined,
    });
    expect(seen).not.toContain(MARKER);
    expect(clean.name).toBe('GET /items/[id]');
    expect(clean.status).toEqual({ code: 2 });
    expect(clean.events.map((event) => event.name)).toEqual(['retry']);
    expect(clean.spanContext().traceState).toBeUndefined();
    expect(clean.parentSpanContext?.traceState).toBeUndefined();
    expect(clean.links[0]?.context.traceState).toBeUndefined();
  });

  it.each([
    ['middleware GET /lists/abc-velo', {}, 'middleware GET (route inconnue)'],
    [
      'middleware GET /Velo-pour-Marie',
      { 'next.route': '/lists/[id]' },
      'middleware GET /lists/[id]',
    ],
    ['generateMetadata /layout', {}, 'generateMetadata /layout'],
    ['nouveau span /lists/velo-pour-marie', {}, 'nouveau span (route inconnue)'],
    [
      'render route (app) /items/[id] /lists/velo',
      {},
      'render route (app) /items/[id] (route inconnue)',
    ],
    ['render route (app) /_not-found', {}, 'render route (app) /_not-found'],
  ])('%s → %s', (name, attributes, expected) => {
    expect(scrubSpanName(name, attributes)).toBe(expected);
  });
});

describe('cadres du navigateur (OBS-45)', () => {
  it('refuse un abs_path forgé et un module en texte libre', () => {
    const base = { filename: 'app:///_next/static/chunks/a.js', lineno: 1, function: 'f' };
    expect(isTrustedBrowserFrame(base)).toBe(true);
    expect(isTrustedBrowserFrame({ ...base, abs_path: 'https://evil.example/MARQUEUR.js' })).toBe(
      false,
    );
    expect(isTrustedBrowserFrame({ ...base, filename: 'https://evil.example/a.js' })).toBe(false);
    expect(isTrustedBrowserFrame({ ...base, function: 'Velo pour Marie' })).toBe(false);
  });
});
