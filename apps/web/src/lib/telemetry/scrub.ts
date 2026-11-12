import type { Attributes, SpanContext } from '@opentelemetry/api';
import type { ReadableSpan, TimedEvent } from '@opentelemetry/sdk-trace';
import type { ErrorEvent, Exception, StackFrame } from '@sentry/nextjs';

/**
 * Nettoyage de ce qui part du web vers un outil d'observation (OBS-20, OBS-22). Pendant de
 * `apps/api/src/platform/telemetry/scrub.ts` : mêmes listes d'attributs (OBS-29), plus ce que
 * Next pose lui-même (`next.span_name`, noms de spans). Ce module est pur : il sert au serveur
 * Next, au navigateur et au relais `/monitoring`. La troisième copie de la liste est la seconde
 * barrière du collecteur (`ops/observability/otel-collector.yaml`) ; les trois restent alignées.
 */

/** OBS-29 : attributs interdits, posés par défaut par les instrumentations. */
export const FORBIDDEN_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  'url.full',
  'url.query',
  'url.path',
  'url.fragment',
  'http.url',
  'http.target',
  'db.query.text',
  'db.statement',
  'exception.message',
  'exception.stacktrace',
  'client.address',
  'client.port',
  'network.peer.address',
  'network.peer.port',
  'net.peer.ip',
  'http.client_ip',
  'user_agent.original',
  'http.user_agent',
  'enduser.id',
  'enduser.role',
  'enduser.scope',
  'user.id',
  'user.name',
  'user.full_name',
  'user.email',
  'process.command',
  'process.command_args',
  'process.command_line',
  'process.executable.path',
  'process.owner',
  'host.name',
  'host.id',
  'host.ip',
  'host.mac',
  // Next : copie du nom de span d'origine, qui contient l'URL résolue (OBS-21).
  'next.span_name',
]);

export const FORBIDDEN_ATTRIBUTE_PREFIXES: readonly string[] = [
  'http.request.header.',
  'http.response.header.',
  'http.request.body',
  'http.response.body',
  'db.query.parameter.',
  'rpc.request.metadata.',
  'rpc.response.metadata.',
  'messaging.message.body',
  'gen_ai.prompt',
  'gen_ai.completion',
  'gen_ai.input',
  'gen_ai.output',
];

export function isForbiddenAttribute(key: string): boolean {
  return (
    FORBIDDEN_ATTRIBUTE_KEYS.has(key) ||
    FORBIDDEN_ATTRIBUTE_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

export function scrubAttributes(attributes: Attributes): Attributes {
  const result: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!isForbiddenAttribute(key)) result[key] = value;
  }
  return result;
}

const HTTP_METHOD = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE)$/;

/** Gabarit de route Next (`/items/[id]`), sans chaîne de requête. */
function routeTemplate(attributes: Attributes): string | undefined {
  const route = attributes['next.route'] ?? attributes['http.route'];
  return typeof route === 'string' && route.startsWith('/') ? route.split(/[?#]/)[0] : undefined;
}

/**
 * OBS-21 : Next nomme ses spans d'après l'URL résolue, chaîne de requête comprise
 * (`GET /items/abc?url=…`, `fetch GET http://api:4000/api/x?y=1`). On garde :
 * - pour une URL (`fetch …`), l'origine seulement (OBS-24 : le domaine, jamais l'URL) ;
 * - pour tout chemin (`GET /items/abc`, `middleware GET /lists/abc`), le gabarit de route s'il
 *   est connu et que le nom désigne la requête (`MÉTHODE /chemin`), sinon `(route inconnue)` ;
 * - les gabarits que Next écrit lui-même (`render route (app) /items/[id]`) sont gardés.
 */
export function scrubSpanName(name: string, attributes: Attributes): string {
  const withoutUrls = name.replace(/\b(https?):\/\/[^\s/?#]+[^\s]*/g, (url) => {
    try {
      return new URL(url).origin;
    } catch {
      return '(url)';
    }
  });
  const words = withoutUrls.replace(/[?#]\S*/g, '').split(' ');
  const [first, second] = words;
  const template = routeTemplate(attributes);
  if (words.length === 2 && first && second?.startsWith('/') && HTTP_METHOD.test(first)) {
    return `${first} ${template ?? '(route inconnue)'}`;
  }
  // Un chemin n'est gardé que dans un nom dont Next 15.5 remplit le chemin avec un gabarit tiré
  // de ses fichiers (vérifié dans les sources de Next à la revue de sécurité de la tâche 5 ; à
  // revérifier à chaque montée de version de Next, OBS-48). Partout ailleurs, y compris après
  // une méthode (`middleware GET /lists/abc`), c'est peut-être le chemin réel : remplacé.
  const prefix = KNOWN_TEMPLATE_PREFIXES.find((known) => withoutUrls.startsWith(`${known} `));
  return words
    .map((word, index) => {
      if (!word.startsWith('/') && !word.startsWith('\\')) return word;
      if (word === template) return word;
      const isTemplatePosition = prefix !== undefined && index === prefix.split(' ').length;
      if (isTemplatePosition && FILE_ROUTE.test(word)) return word;
      return template ?? '(route inconnue)';
    })
    .join(' ');
}

/** Noms de spans de Next 15.5 dont le chemin est un gabarit de fichier. */
const KNOWN_TEMPLATE_PREFIXES: readonly string[] = [
  'render route (app)',
  'prerender route (app)',
  'executing api route (app)',
  'executing api route (pages)',
  'generateMetadata',
  'generateViewport',
  'getServerSideProps',
  'getStaticProps',
];

/** Chemin de fichier de route Next : segments simples, groupes `(x)`, dynamiques `[id]`. */
const FILE_ROUTE =
  /^(?:[/\\](?:[\w\-.@]{1,60}|\(\w{1,40}\)|\[{1,2}(?:\.{3})?\w{1,40}\]{1,2}))*[/\\]?$/;

/** Contexte de span sans `traceState` (texte libre venu du client, OBS-29). */
export function scrubSpanContext(context: SpanContext): SpanContext {
  return {
    traceId: context.traceId,
    spanId: context.spanId,
    traceFlags: context.traceFlags,
    ...(context.isRemote !== undefined ? { isRemote: context.isRemote } : {}),
  };
}

/** Span reconstruit champ par champ, comme dans l'API, avec un nom nettoyé. */
export function scrubSpan(span: ReadableSpan): ReadableSpan {
  const events: TimedEvent[] = span.events
    .filter((event) => event.name !== 'exception')
    .map((event) => ({
      name: event.name,
      time: event.time,
      ...(event.attributes ? { attributes: scrubAttributes(event.attributes) } : {}),
      ...(event.droppedAttributesCount !== undefined
        ? { droppedAttributesCount: event.droppedAttributesCount }
        : {}),
    }));

  const spanContext = scrubSpanContext(span.spanContext());
  return {
    name: scrubSpanName(span.name, span.attributes),
    kind: span.kind,
    spanContext: () => spanContext,
    ...(span.parentSpanContext
      ? { parentSpanContext: scrubSpanContext(span.parentSpanContext) }
      : {}),
    startTime: span.startTime,
    endTime: span.endTime,
    status: { code: span.status.code },
    attributes: scrubAttributes(span.attributes),
    links: span.links.map((link) => ({
      context: scrubSpanContext(link.context),
      ...(link.attributes ? { attributes: scrubAttributes(link.attributes) } : {}),
    })),
    events,
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
}

/** Codes d'erreur techniques transmissibles (`ECONNREFUSED`, `P2002`). */
const ERROR_CODE_PATTERN = /^(?:[A-Z][A-Z0-9_]{1,63}|P\d{4})$/;

export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === 'string' && ERROR_CODE_PATTERN.test(code) ? code : undefined;
}

/** Nom d'erreur : un identifiant, sinon `Error` (un nom peut être réécrit avec du texte). */
export function safeErrorName(name: unknown): string {
  return typeof name === 'string' && /^[\w$.]{1,100}$/.test(name) ? name : 'Error';
}

/**
 * Nom de fonction d'un cadre : identifiants séparés par des points, jamais du texte libre.
 * Les moteurs des navigateurs ajoutent `/<` ou `@` (Firefox) : refusés, le cadre garde son
 * emplacement sans nom.
 */
const FUNCTION_NAME =
  /^(?:async )?(?:new )?(?:[\w$<>.]|\[Symbol\.\w{1,40}\]){1,200}(?: \[as [\w$<>]{1,100}\])?$/;

export function isTrustedFunctionName(name: string | undefined): boolean {
  return name === undefined || name === '?' || FUNCTION_NAME.test(name);
}

/**
 * Cadres du navigateur (OBS-45, version navigateur) : seuls nos propres fichiers, réécrits en
 * `app:///_next/static/…` par l'intégration de normalisation de `@sentry/nextjs`. Un cadre
 * d'extension, d'un autre site ou forgé dans un message (« at x (https://…:1:2) ») est écarté.
 * Risque résiduel, comme pour l'API : une ligne de message qui citerait un chemin de nos chunks.
 */
const BROWSER_FRAME_PATH = /^app:\/\/\/_next\/static\/[\w\-./[\]()@~]{1,300}\.js$/;

export function isTrustedBrowserFrame(frame: StackFrame): boolean {
  const isOurs = (path: unknown): boolean => {
    if (typeof path !== 'string') return false;
    const clean = path.split(/[?#]/)[0] ?? '';
    return BROWSER_FRAME_PATH.test(clean) && !clean.includes('/../');
  };
  return (
    typeof frame.lineno === 'number' &&
    isOurs(frame.filename) &&
    // Le SDK du navigateur ne pose pas `abs_path` ; le relais peut en recevoir un forgé.
    (frame.abs_path === undefined || isOurs(frame.abs_path)) &&
    isTrustedFunctionName(frame.function)
  );
}

/**
 * Éléments d'un tableau qui sont des objets. Les types de Sentry le promettent, mais le relais
 * applique ce nettoyage à ce qu'envoie le navigateur, qui peut être n'importe quoi.
 */
function objects<T extends object>(values: readonly unknown[]): T[] {
  return values.filter((value): value is T => typeof value === 'object' && value !== null);
}

/** Nom de module calculé par le SDK (`app.page`, `next.dist.server:render`) : pas d'espace. */
const MODULE_NAME = /^[\w$.\-:/@]{1,200}$/;

function scrubFrame(frame: StackFrame): StackFrame {
  // Ni variables locales, ni lignes de contexte, ni chaîne de requête (`?dpl=…`).
  // Chaque champ est contrôlé dans sa forme : le relais reçoit des cadres forgés possibles.
  const kept: StackFrame = {};
  if (typeof frame.filename === 'string') kept.filename = frame.filename.split(/[?#]/)[0];
  if (typeof frame.abs_path === 'string') kept.abs_path = frame.abs_path.split(/[?#]/)[0];
  if (typeof frame.module === 'string' && MODULE_NAME.test(frame.module))
    kept.module = frame.module;
  if (typeof frame.function === 'string') kept.function = frame.function;
  if (typeof frame.lineno === 'number') kept.lineno = frame.lineno;
  if (typeof frame.colno === 'number') kept.colno = frame.colno;
  if (typeof frame.in_app === 'boolean') kept.in_app = frame.in_app;
  return kept;
}

function scrubException(
  exception: Exception,
  isTrustedFrame: (frame: StackFrame) => boolean,
): Exception {
  // Pas de `value` : c'est le message de l'exception (OBS-25, OBS-29).
  const kept: Exception = {};
  if (exception.type !== undefined) kept.type = safeErrorName(exception.type);
  if (exception.mechanism && typeof exception.mechanism.type === 'string') {
    kept.mechanism = {
      type: safeErrorName(exception.mechanism.type),
      ...(typeof exception.mechanism.handled === 'boolean'
        ? { handled: exception.mechanism.handled }
        : {}),
    };
  }
  if (Array.isArray(exception.stacktrace?.frames)) {
    kept.stacktrace = {
      frames: objects<StackFrame>(exception.stacktrace.frames)
        .filter(isTrustedFrame)
        .map(scrubFrame),
    };
  }
  return kept;
}

/** Étiquettes que nous posons nous-mêmes (`onRequestError`). Toute autre est retirée. */
const ALLOWED_TAGS = new Set(['http.route', 'http.request.method', 'error.code', 'runtime']);

/** Identifiants, versions, gabarits de route (`/items/[id]`) : pas de texte libre. */
const SHORT_TEXT = /^[\w\-.:/[\]() ]{1,100}$/;

function shortText(value: unknown): string | undefined {
  return typeof value === 'string' && SHORT_TEXT.test(value) ? value : undefined;
}

/**
 * Événement d'erreur reconstruit en liste blanche. Disparaissent : requête (URL de la page,
 * en-têtes, cookies), utilisateur, fils d'Ariane, `extra`, message, nom de transaction (URL),
 * contextes autres que `trace` et `runtime`. Les champs conservés sont aussi contrôlés dans
 * leur forme : le relais `/monitoring` applique cette fonction à ce que le navigateur envoie,
 * qui n'est pas digne de confiance.
 */
export function scrubErrorEvent(
  event: ErrorEvent,
  isTrustedFrame: (frame: StackFrame) => boolean,
): ErrorEvent {
  const kept: ErrorEvent = { type: undefined };
  if (typeof event.event_id === 'string' && /^[0-9a-f]{32}$/.test(event.event_id)) {
    kept.event_id = event.event_id;
  }
  if (typeof event.timestamp === 'number') kept.timestamp = event.timestamp;
  const platform = shortText(event.platform);
  if (platform) kept.platform = platform;
  if (event.level === 'error' || event.level === 'fatal' || event.level === 'warning') {
    kept.level = event.level;
  }
  const environment = shortText(event.environment);
  if (environment) kept.environment = environment;
  const release = shortText(event.release);
  if (release) kept.release = release;
  const sdkName = shortText(event.sdk?.name);
  const sdkVersion = shortText(event.sdk?.version);
  if (sdkName && sdkVersion) kept.sdk = { name: sdkName, version: sdkVersion };
  // `debug_meta` : identifiants de débogage des cartes (OBS-31), sans chemin local.
  if (Array.isArray(event.debug_meta?.images)) {
    const images = event.debug_meta.images.flatMap((image) => {
      const record = image as { type?: unknown; code_file?: unknown; debug_id?: unknown };
      return record.type === 'sourcemap' &&
        typeof record.debug_id === 'string' &&
        /^[0-9a-f-]{32,36}$/i.test(record.debug_id) &&
        typeof record.code_file === 'string' &&
        BROWSER_FRAME_PATH.test(record.code_file.split(/[?#]/)[0] ?? '')
        ? [
            {
              type: 'sourcemap',
              code_file: record.code_file.split(/[?#]/)[0],
              debug_id: record.debug_id,
            },
          ]
        : [];
    });
    if (images.length > 0) kept.debug_meta = { images } as ErrorEvent['debug_meta'];
  }

  if (Array.isArray(event.exception?.values)) {
    kept.exception = {
      values: objects<Exception>(event.exception.values).map((value) =>
        scrubException(value, isTrustedFrame),
      ),
    };
  }

  if (event.tags) {
    const tags: Record<string, string> = {};
    for (const [key, value] of Object.entries(event.tags)) {
      const text = shortText(value);
      if (ALLOWED_TAGS.has(key) && text) tags[key] = text;
    }
    kept.tags = tags;
  }

  const trace = event.contexts?.trace;
  const runtime = event.contexts?.runtime;
  if (trace || runtime) {
    kept.contexts = {};
    if (
      typeof trace?.trace_id === 'string' &&
      /^[0-9a-f]{32}$/.test(trace.trace_id) &&
      typeof trace.span_id === 'string' &&
      /^[0-9a-f]{16}$/.test(trace.span_id)
    ) {
      kept.contexts.trace = { trace_id: trace.trace_id, span_id: trace.span_id };
    }
    const runtimeName = shortText(runtime?.name);
    const runtimeVersion = shortText(runtime?.version);
    if (runtimeName || runtimeVersion) {
      kept.contexts.runtime = {
        ...(runtimeName ? { name: runtimeName } : {}),
        ...(runtimeVersion ? { version: runtimeVersion } : {}),
      };
    }
  }
  return kept;
}

/** Événement du navigateur : seuls nos chunks comme cadres. */
export function scrubBrowserEvent(event: ErrorEvent): ErrorEvent {
  return scrubErrorEvent(event, isTrustedBrowserFrame);
}
