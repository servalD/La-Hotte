import { context } from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';
import type { ErrorEvent } from '@sentry/nextjs';
import { scrubBrowserEvent } from './scrub';

/**
 * Relais `/monitoring` (OBS-33) : reçoit les enveloppes du SDK navigateur sur notre origine et
 * les transmet à notre projet GlitchTip, et à lui seul. Un relais qui accepterait n'importe
 * quelle destination serait un relais ouvert.
 *
 * - destination fixe, tirée du DSN configuré ; le DSN de l'enveloppe doit être le même (hôte,
 *   projet, clé), sinon 403 ;
 * - corps seul : ni en-têtes ni adresse du navigateur ne sont retransmis ;
 * - seuls les éléments `event` passent, nettoyés à nouveau ici (`scrubBrowserEvent`) : ce que le
 *   navigateur envoie n'est pas digne de confiance (OBS-20) ;
 * - taille (413) et débit (429) limités.
 */

export const MAX_BODY_BYTES = 200_000;
const FORWARD_TIMEOUT_MS = 5000;

export interface Dsn {
  /** Forme canonique, reportée dans l'enveloppe transmise. */
  readonly value: string;
  readonly origin: string;
  readonly publicKey: string;
  readonly projectId: string;
}

export function parseDsn(value: unknown): Dsn | undefined {
  if (typeof value !== 'string' || value.length > 500) return undefined;
  try {
    const url = new URL(value);
    const projectId = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!/^https?:$/.test(url.protocol) || !/^\d{1,20}$/.test(projectId) || !url.username) {
      return undefined;
    }
    const publicKey = decodeURIComponent(url.username);
    return {
      value: `${url.protocol}//${url.username}@${url.host}/${projectId}`,
      origin: url.origin,
      publicKey,
      projectId,
    };
  } catch {
    return undefined;
  }
}

function sameDsn(a: Dsn, b: Dsn): boolean {
  return a.origin === b.origin && a.publicKey === b.publicKey && a.projectId === b.projectId;
}

/**
 * Débit limité par fenêtre fixe : par adresse et au total. L'adresse ne sert qu'en mémoire, le
 * temps de la fenêtre ; elle n'est ni journalisée ni transmise.
 */
export class FixedWindowLimiter {
  private windowStart = 0;
  private total = 0;
  private readonly perClient = new Map<string, number>();

  constructor(
    private readonly options: {
      windowMs: number;
      perClient: number;
      total: number;
      maxClients: number;
      now?: () => number;
    },
  ) {}

  allow(client: string): boolean {
    const now = (this.options.now ?? Date.now)();
    if (now - this.windowStart >= this.options.windowMs) {
      this.windowStart = now;
      this.total = 0;
      this.perClient.clear();
    }
    if (this.total >= this.options.total) return false;
    // Au-delà de `maxClients` adresses dans la fenêtre, elles partagent un même compteur.
    const key =
      this.perClient.has(client) || this.perClient.size < this.options.maxClients ? client : '*';
    const count = this.perClient.get(key) ?? 0;
    if (count >= this.options.perClient) return false;
    this.perClient.set(key, count + 1);
    this.total += 1;
    return true;
  }
}

/**
 * Dernière adresse de `X-Forwarded-For`, celle qu'ajoute Caddy ; les précédentes viennent du
 * client. Hypothèse (OBS-33) : Next n'est joignable que derrière Caddy, sans `trusted_proxies`.
 * Une adresse IPv6 est réduite à son /64 : un client en dispose d'un bloc entier.
 */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const last = forwarded?.split(',').pop()?.trim();
  if (!last || last.length > 64) return 'direct';
  if (!last.includes(':')) return last;
  // Adresse IPv4 écrite en IPv6 (`::ffff:203.0.113.7`) : c'est l'adresse IPv4 qui compte.
  const mapped = /^\[?::ffff:(\d{1,3}(?:\.\d{1,3}){3})\]?(?::\d+)?$/i.exec(last)?.[1];
  if (mapped) return mapped;
  return ipv6Prefix64(last) ?? 'direct';
}

/** Quatre premiers groupes d'une adresse IPv6, forme `::` développée. */
export function ipv6Prefix64(address: string): string | undefined {
  const bare =
    address
      .replace(/^\[|\](?::\d+)?$/g, '')
      .split('%')[0]
      ?.toLowerCase() ?? '';
  if (!/^[0-9a-f:.]{2,45}$/.test(bare)) return undefined;
  const [head = '', tail, ...more] = bare.split('::');
  if (more.length > 0) return undefined;
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  // Une IPv4 en fin d'adresse (`64:ff9b::192.0.2.1`) occupe deux groupes.
  const embeddedIpv4 = bare.includes('.') ? 1 : 0;
  const missing = 8 - left.length - right.length - embeddedIpv4;
  if (tail === undefined ? missing !== 0 : missing < 1) return undefined;
  const groups = [...left, ...Array<string>(Math.max(missing, 0)).fill('0'), ...right];
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/**
 * Le SDK envoie depuis nos pages : `Sec-Fetch-Site: same-origin`. Une page tierce pourrait
 * faire poster les navigateurs de ses visiteurs (corps `text/plain`, sans prévol). Un client
 * sans cet en-tête (navigateur ancien, outil) est accepté, sauf `Origin` étrangère.
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin';
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

type BodyResult = { ok: true; bytes: Uint8Array } | { ok: false };

async function readBody(request: Request, max: number): Promise<BodyResult> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > max) return { ok: false };
  if (!request.body) return { ok: true, bytes: new Uint8Array() };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return { ok: false };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

interface EnvelopeItem {
  header: Record<string, unknown>;
  payload: Uint8Array;
}

interface Envelope {
  header: Record<string, unknown>;
  items: EnvelopeItem[];
}

const NEWLINE = 0x0a;
const decoder = new TextDecoder('utf-8', { fatal: true });

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> {
  const value: unknown = JSON.parse(decoder.decode(bytes));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('not an object');
  }
  return value as Record<string, unknown>;
}

function lineEnd(bytes: Uint8Array, from: number): number {
  const index = bytes.indexOf(NEWLINE, from);
  return index === -1 ? bytes.length : index;
}

/** Format d'enveloppe Sentry : en-tête, puis paires en-tête d'élément / charge utile. */
export function parseEnvelope(bytes: Uint8Array): Envelope {
  const headerEnd = lineEnd(bytes, 0);
  const header = parseJsonObject(bytes.subarray(0, headerEnd));
  const items: EnvelopeItem[] = [];
  let position = headerEnd + 1;
  while (position < bytes.length) {
    const itemHeaderEnd = lineEnd(bytes, position);
    if (itemHeaderEnd === position) {
      position += 1; // ligne vide finale
      continue;
    }
    const itemHeader = parseJsonObject(bytes.subarray(position, itemHeaderEnd));
    position = itemHeaderEnd + 1;
    const length = itemHeader.length;
    let payload: Uint8Array;
    if (typeof length === 'number') {
      if (!Number.isInteger(length) || length < 0 || position + length > bytes.length) {
        throw new Error('bad length');
      }
      payload = bytes.subarray(position, position + length);
      position += length + 1;
    } else {
      const payloadEnd = lineEnd(bytes, position);
      payload = bytes.subarray(position, payloadEnd);
      position = payloadEnd + 1;
    }
    items.push({ header: itemHeader, payload });
  }
  return { header, items };
}

const SDK_TEXT = /^[\w\-.:/]{1,100}$/;

/** En-tête d'enveloppe reconstruit : ni `trace` (contexte d'échantillonnage), ni autre champ. */
function cleanEnvelopeHeader(header: Record<string, unknown>, dsn: Dsn): Record<string, unknown> {
  const kept: Record<string, unknown> = { dsn: dsn.value };
  if (typeof header.event_id === 'string' && /^[0-9a-f]{32}$/.test(header.event_id)) {
    kept.event_id = header.event_id;
  }
  if (typeof header.sent_at === 'string' && /^[\d\-T:.Z+]{10,40}$/.test(header.sent_at)) {
    kept.sent_at = header.sent_at;
  }
  const sdk = header.sdk as { name?: unknown; version?: unknown } | undefined;
  if (
    typeof sdk?.name === 'string' &&
    SDK_TEXT.test(sdk.name) &&
    typeof sdk.version === 'string' &&
    SDK_TEXT.test(sdk.version)
  ) {
    kept.sdk = { name: sdk.name, version: sdk.version };
  }
  return kept;
}

export type ForwardFn = (url: string, body: string) => Promise<{ ok: boolean }>;

export interface RelayOptions {
  /** DSN du projet navigateur ; absent, le relais n'existe pas (OBS-14). */
  dsn: Dsn | undefined;
  limiter: FixedWindowLimiter;
  forward: ForwardFn;
}

const empty = (status: number): Response => new Response(null, { status });

export function createRelay(options: RelayOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    const { dsn } = options;
    if (!dsn) return empty(404);
    if (!isSameOrigin(request)) return empty(403);
    if (!options.limiter.allow(clientAddress(request.headers))) return empty(429);

    const body = await readBody(request, MAX_BODY_BYTES);
    if (!body.ok) return empty(413);

    let envelope: Envelope;
    try {
      envelope = parseEnvelope(body.bytes);
    } catch {
      return empty(400);
    }
    const target = parseDsn(envelope.header.dsn);
    if (!target) return empty(400);
    if (!sameDsn(target, dsn)) return empty(403);

    const lines: string[] = [];
    for (const item of envelope.items) {
      if (item.header.type !== 'event') continue;
      // Le SDK n'envoie qu'une erreur par enveloppe ; au-delà, c'est une injection en nombre.
      if (lines.length > 0) return empty(400);
      let event: ErrorEvent;
      try {
        // Forme non vérifiée : `scrubBrowserEvent` contrôle chaque champ qu'il garde.
        event = parseJsonObject(item.payload) as unknown as ErrorEvent;
      } catch {
        return empty(400);
      }
      lines.push(JSON.stringify({ type: 'event' }), JSON.stringify(scrubBrowserEvent(event)));
    }
    // Rien d'autre que des erreurs : sessions, rapports, transactions sont abandonnés.
    if (lines.length === 0) return empty(200);

    const out = [JSON.stringify(cleanEnvelopeHeader(envelope.header, dsn)), ...lines].join('\n');
    try {
      const result = await options.forward(`${dsn.origin}/api/${dsn.projectId}/envelope/`, out);
      return empty(result.ok ? 200 : 502);
    } catch {
      return empty(502);
    }
  };
}

/**
 * Envoi réel vers GlitchTip : corps seul, aucune redirection suivie, délai borné, ni span ni
 * `traceparent` (bruit, et boucle si GlitchTip échoue). `fetchImpl` est remplaçable en test.
 */
// Seul appel réseau écrit à la main hors de `lib/api` : un envoi serveur vers GlitchTip, pas une
// donnée de l'application (le lint interdit `fetch` ailleurs).
export function createForward(fetchImpl: typeof fetch = globalThis.fetch): ForwardFn {
  return (url, body) =>
    context.with(suppressTracing(context.active()), () =>
      fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
        body,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      }),
    );
}
