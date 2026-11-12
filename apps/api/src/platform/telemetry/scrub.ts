import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Attributes } from '@opentelemetry/api';
import type { ReadableSpan, TimedEvent } from '@opentelemetry/sdk-trace';
import type { ErrorEvent, Exception, StackFrame } from '@sentry/nestjs';

/**
 * Nettoyage de tout ce qui part vers un outil d'observation (OBS-20, OBS-22).
 * Seul point de passage : attributs de spans et de métriques, événements d'erreur, erreurs
 * journalisées. Un rapport d'erreur est un canal de sortie : la règle de surprise (VIS-20)
 * s'y applique.
 *
 * Principe : pour les événements d'erreur, liste blanche (on reconstruit l'événement champ par
 * champ) ; pour les attributs OpenTelemetry, liste noire (OBS-29), doublée par le processeur du
 * collecteur (`ops/observability/otel-collector.yaml`). Les deux listes doivent rester alignées.
 */

/** OBS-29 : attributs interdits, posés par défaut par les instrumentations automatiques. */
export const FORBIDDEN_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  // URL résolue et chaîne de requête : on garde le gabarit `http.route`, jamais l'URL (OBS-21).
  'url.full',
  'url.query',
  'url.path',
  'url.fragment',
  'http.url',
  'http.target',
  // Texte SQL avec ses valeurs, commandes Redis avec leurs arguments (OBS-23).
  'db.query.text',
  'db.statement',
  // L'erreur va à GlitchTip, le span ne la répète pas (OBS-29).
  'exception.message',
  'exception.stacktrace',
  // Adresses et agent du client.
  'client.address',
  'client.port',
  'network.peer.address',
  'network.peer.port',
  'net.peer.ip',
  'http.client_ip',
  'user_agent.original',
  'http.user_agent',
  // Identité (OBS-21 : aucun contexte utilisateur).
  'enduser.id',
  'enduser.role',
  'enduser.scope',
  'user.id',
  'user.name',
  'user.full_name',
  'user.email',
  // Ressource : ligne de commande et machine.
  'process.command',
  'process.command_args',
  'process.command_line',
  'process.executable.path',
  'process.owner',
  'host.name',
  'host.id',
  'host.ip',
  'host.mac',
]);

/** Familles d'attributs interdites : en-têtes, paramètres SQL, corps de messages, prompts. */
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

/** Copie des attributs sans les clés interdites. */
export function scrubAttributes(attributes: Attributes): Attributes {
  const result: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!isForbiddenAttribute(key)) result[key] = value;
  }
  return result;
}

/**
 * Span nettoyé, reconstruit champ par champ (les spans du SDK ne sont pas modifiables une fois
 * terminés). Retire les événements `exception`, le message de statut (souvent le message de
 * l'exception) et les attributs interdits du span, de ses événements et de ses liens.
 */
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

  return {
    name: span.name,
    kind: span.kind,
    spanContext: () => span.spanContext(),
    ...(span.parentSpanContext ? { parentSpanContext: span.parentSpanContext } : {}),
    startTime: span.startTime,
    endTime: span.endTime,
    status: { code: span.status.code },
    attributes: scrubAttributes(span.attributes),
    links: span.links.map((link) => ({
      context: link.context,
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

/** Codes d'erreur techniques qu'on accepte de transmettre (`P2002`, `ECONNREFUSED`, `INTERNAL_ERROR`). */
const ERROR_CODE_PATTERN = /^(?:[A-Z][A-Z0-9_]{1,63}|P\d{4})$/;

/** Code stable d'une erreur, s'il a la forme d'un code et non d'un texte libre. */
export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === 'string' && ERROR_CODE_PATTERN.test(code) ? code : undefined;
}

/**
 * Racine de l'application (`apps/api` en local, `/app` dans l'image) : ce fichier est dans
 * `src/platform/telemetry` ou `dist/platform/telemetry`.
 */
export const APP_ROOT = normalizePath(resolve(__dirname, '..', '..', '..'));

/**
 * Racines de confiance, chacune terminée par `/`. En développement, les dépendances sont dans
 * le `node_modules` à la racine du dépôt pnpm, que l'on ne retient que s'il s'agit bien du dépôt
 * (présence de `pnpm-workspace.yaml`) : dans l'image, `../..` vaut `/`, trop large.
 */
const TRUSTED_ROOTS: readonly string[] = (() => {
  const roots = [`${APP_ROOT}/`];
  const repo = resolve(__dirname, '..', '..', '..', '..', '..');
  if (existsSync(resolve(repo, 'pnpm-workspace.yaml'))) {
    roots.push(`${normalizePath(resolve(repo, 'node_modules'))}/`);
  }
  // Racine vide ou `/` : aucun cadre de l'application n'est de confiance (échec sûr).
  return APP_ROOT.split('/').filter(Boolean).length > 0 ? roots : roots.slice(1);
})();

/** Modules internes de Node : `node:internal/timers`, `node:events`. */
const NODE_INTERNAL = /^node:[a-z_]+(?:\/[a-z_]+)*$/;

function normalizePath(path: string): string {
  return path
    .replace(/^file:\/\/\/?/, '/')
    .replace(/\\/g, '/')
    .replace(/^\/(?=[A-Za-z]:)/, '')
    .toLowerCase();
}

/**
 * Nom de fonction d'un cadre : identifiants séparés par des points (`Foo.[Symbol.asyncIterator]`
 * compris), jamais du texte libre.
 */
const FUNCTION_NAME =
  /^(?:async )?(?:new )?(?:[\w$<>.]|\[Symbol\.\w{1,40}\]){1,200}(?: \[as [\w$<>]{1,100}\])?$/;

/** Chemin sans espace terminé par `:ligne:colonne`. */
const LOCATION = /^(?<path>[^\s()]{1,500}):\d{1,7}:\d{1,7}$/;

/**
 * Emplacement de confiance (OBS-45) : un fichier sous la racine de l'application (dépendances
 * de l'image comprises), sous le `node_modules` du dépôt, ou un module interne de Node. Un
 * message forgé pour ressembler à un cadre ne passe pas ce filtre, sauf à citer un chemin absolu
 * de l'application (risque résiduel accepté par la revue de sécurité du 2026-11-12).
 */
export function isTrustedPath(path: string | undefined): boolean {
  if (!path) return false;
  if (path.startsWith('node:')) return NODE_INTERNAL.test(path);
  const normalized = normalizePath(path);
  if (normalized.includes('/../') || normalized.includes('/./')) return false;
  return TRUSTED_ROOTS.some((root) => normalized.startsWith(root));
}

export function isTrustedFunctionName(name: string | undefined): boolean {
  return name === undefined || name === '?' || FUNCTION_NAME.test(name);
}

const FRAME_LINE =
  /^\s+at (?:(?<fn>[^()\n]{1,300}) \((?<inner>[^()\n]{1,520})\)|(?<bare>[^()\s]{1,520}))$/;

/**
 * Ligne de cadre V8 acceptée : `at fn (/chemin:1:2)`, `at /chemin:1:2`, `at fn (<anonymous>)`,
 * avec un nom de fonction et un emplacement de confiance.
 */
export function isTrustedFrameLine(line: string): boolean {
  const groups = FRAME_LINE.exec(line)?.groups;
  if (!groups) return false;
  if (!isTrustedFunctionName(groups.fn)) return false;
  const location = groups.inner ?? groups.bare ?? '';
  if (groups.fn !== undefined && (location === '<anonymous>' || location === 'native')) return true;
  return isTrustedPath(LOCATION.exec(location)?.groups?.path);
}

/**
 * Cadres d'une pile, sans son en-tête `Nom: message`. Le message d'une erreur tierce (Prisma,
 * pilote) peut citer une valeur et tenir sur plusieurs lignes, dont certaines ressemblent à des
 * cadres (« Can't reach database server at `hôte` », constaté le 2026-11-12). On coupe ce qui
 * précède la fin du message quand on le retrouve, puis chaque ligne doit être un cadre de
 * confiance : la découpe peut échouer (message modifié après coup) sans que rien ne fuie.
 */
export function stackFrames(error: Error): string[] {
  const stack = typeof error.stack === 'string' ? error.stack : '';
  const message = typeof error.message === 'string' ? error.message : '';
  const end = message ? stack.indexOf(message) : -1;
  const body = end >= 0 ? stack.slice(end + message.length) : stack;
  return body.split('\n').filter(isTrustedFrameLine);
}

/**
 * Pile réduite à ses cadres de confiance, pour l'analyseur de pile de Sentry. Il reçoit sinon
 * la pile d'origine des exceptions non gérées, message compris, et prend pour un cadre toute
 * ligne qui contient `at x:1:2` (revue de sécurité du 2026-11-12). La première ligne reste un
 * en-tête neutre : l'analyseur compte `skipFirstLines` depuis elle.
 */
export function trustedStack(stack: string): string {
  return ['Error', ...stack.split('\n').filter(isTrustedFrameLine)].join('\n');
}

/** Nom d'erreur : un identifiant, sinon `Error` (un nom peut être réécrit avec du texte). */
export function safeErrorName(name: unknown): string {
  return typeof name === 'string' && /^[\w$.]{1,100}$/.test(name) ? name : 'Error';
}

/** Pile sans message, pour les journaux. */
export function scrubStack(error: Error): string | undefined {
  const frames = stackFrames(error);
  return frames.length > 0 ? frames.join('\n') : undefined;
}

/** Sérialiseur d'erreur pour les journaux : type, code et cadres, jamais le message. */
export function scrubError(error: unknown): { type: string; code?: string; stack?: string } {
  if (!(error instanceof Error)) return { type: typeof error };
  const code = errorCode(error);
  const stack = scrubStack(error);
  return {
    type: safeErrorName(error.name),
    ...(code ? { code } : {}),
    ...(stack ? { stack } : {}),
  };
}

const MAX_CAUSE_DEPTH = 5;

/**
 * Copie d'une erreur réduite à son type, son code et ses cadres, causes comprises. C'est elle,
 * et non l'erreur d'origine, que reçoit le SDK Sentry : il ne voit jamais le message ni les
 * propriétés de l'erreur (une erreur Prisma porte la requête et ses paramètres).
 */
export function sanitizeError(error: unknown, depth = 0): Error {
  const clean = new Error();
  if (!(error instanceof Error)) {
    clean.name = typeof error;
    clean.stack = clean.name;
    return clean;
  }
  clean.name = safeErrorName(error.name);
  clean.stack = [clean.name, ...stackFrames(error)].join('\n');
  const code = errorCode(error);
  if (code) Object.assign(clean, { code });
  if (error.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    clean.cause = sanitizeError(error.cause, depth + 1);
  }
  return clean;
}

/** Étiquettes que nous posons nous-mêmes (`SentryErrorReporter`). Toute autre est retirée. */
const ALLOWED_TAGS = new Set(['request_id', 'http.route', 'http.request.method', 'error.code']);

/** Cadre déjà analysé par Sentry : emplacement et fonction de confiance, sinon écarté. */
function isTrustedFrame(frame: StackFrame): boolean {
  return (
    typeof frame.lineno === 'number' &&
    isTrustedPath(frame.abs_path ?? frame.filename) &&
    (frame.filename === undefined || isTrustedPath(frame.filename)) &&
    isTrustedFunctionName(frame.function)
  );
}

function scrubFrame(frame: StackFrame): StackFrame {
  // Ni variables locales, ni lignes de contexte : seulement l'emplacement (OBS-28, OBS-32).
  const kept: StackFrame = {};
  if (frame.filename !== undefined) kept.filename = frame.filename;
  if (frame.abs_path !== undefined) kept.abs_path = frame.abs_path;
  if (frame.module !== undefined) kept.module = frame.module;
  if (frame.function !== undefined) kept.function = frame.function;
  if (frame.lineno !== undefined) kept.lineno = frame.lineno;
  if (frame.colno !== undefined) kept.colno = frame.colno;
  if (frame.in_app !== undefined) kept.in_app = frame.in_app;
  return kept;
}

function scrubException(exception: Exception): Exception {
  // Pas de `value` : c'est le message de l'exception (OBS-25, OBS-29).
  const kept: Exception = {};
  if (exception.type !== undefined) kept.type = safeErrorName(exception.type);
  if (exception.mechanism) {
    kept.mechanism = {
      type: exception.mechanism.type,
      ...(exception.mechanism.handled !== undefined
        ? { handled: exception.mechanism.handled }
        : {}),
    };
  }
  if (exception.stacktrace?.frames) {
    // Seconde barrière après `trustedStack` : un cadre hors de l'application, de ses
    // dépendances et de Node vient d'une ligne de message, pas du code.
    kept.stacktrace = {
      frames: exception.stacktrace.frames.filter(isTrustedFrame).map(scrubFrame),
    };
  }
  return kept;
}

/**
 * Événement d'erreur reconstruit en liste blanche. Disparaissent : requête (URL, en-têtes,
 * cookies, corps), utilisateur, fils d'Ariane, `extra`, message, nom de machine, nom de
 * transaction (peut être l'URL résolue), modules, contextes autres que `trace` et `runtime`.
 */
export function scrubErrorEvent(event: ErrorEvent): ErrorEvent {
  const kept: ErrorEvent = { type: undefined };
  if (event.event_id !== undefined) kept.event_id = event.event_id;
  if (event.timestamp !== undefined) kept.timestamp = event.timestamp;
  if (event.platform !== undefined) kept.platform = event.platform;
  if (event.level !== undefined) kept.level = event.level;
  if (event.environment !== undefined) kept.environment = event.environment;
  if (event.release !== undefined) kept.release = event.release;
  if (event.sdk !== undefined) kept.sdk = event.sdk;
  if (event.fingerprint !== undefined) kept.fingerprint = event.fingerprint;
  if (event.debug_meta !== undefined) kept.debug_meta = event.debug_meta;

  if (event.exception?.values) {
    kept.exception = { values: event.exception.values.map(scrubException) };
  }

  if (event.tags) {
    const tags: Record<string, string | number | boolean | null | undefined> = {};
    for (const [key, value] of Object.entries(event.tags)) {
      if (ALLOWED_TAGS.has(key)) tags[key] = value as string;
    }
    kept.tags = tags;
  }

  const trace = event.contexts?.trace;
  const runtime = event.contexts?.runtime;
  if (trace || runtime) {
    kept.contexts = {};
    if (trace?.trace_id && trace.span_id) {
      kept.contexts.trace = { trace_id: trace.trace_id, span_id: trace.span_id };
    }
    if (runtime) {
      kept.contexts.runtime = {
        ...(runtime.name ? { name: runtime.name } : {}),
        ...(runtime.version ? { version: runtime.version } : {}),
      };
    }
  }
  return kept;
}
