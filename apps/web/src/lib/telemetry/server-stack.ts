import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StackFrame } from '@sentry/nextjs';
import { errorCode, isTrustedFunctionName, safeErrorName } from './scrub';

/**
 * OBS-45 pour le serveur Next : le SDK ne reçoit qu'une copie réduite de l'erreur, et seuls les
 * cadres de confiance passent. Pendant de `apps/api/src/platform/telemetry/scrub.ts`.
 *
 * Racine de l'application : le répertoire de lancement (`next start` tourne dans `apps/web`, le
 * serveur autonome dans le répertoire de l'image). Le code compilé est sous `.next/server`.
 */
function normalizePath(path: string): string {
  return path
    .replace(/^file:\/\/\/?/, '/')
    .replace(/\\/g, '/')
    .replace(/^\/(?=[A-Za-z]:)/, '')
    .toLowerCase();
}

export function trustedRoots(cwd: string = process.cwd()): string[] {
  const appRoot = normalizePath(resolve(cwd));
  // Racine vide ou `/` : aucun cadre de l'application n'est de confiance (échec sûr).
  const roots = appRoot.split('/').filter(Boolean).length > 0 ? [`${appRoot}/`] : [];
  const repo = resolve(cwd, '..', '..');
  if (existsSync(resolve(repo, 'pnpm-workspace.yaml'))) {
    roots.push(`${normalizePath(resolve(repo, 'node_modules'))}/`);
  }
  return roots;
}

const TRUSTED_ROOTS = trustedRoots();
const NODE_INTERNAL = /^node:[a-z_]+(?:\/[a-z_]+)*$/;

export function isTrustedServerPath(
  path: string | undefined,
  roots: readonly string[] = TRUSTED_ROOTS,
): boolean {
  if (!path) return false;
  if (path.startsWith('node:')) return NODE_INTERNAL.test(path);
  const normalized = normalizePath(path);
  if (normalized.includes('/../') || normalized.includes('/./')) return false;
  return roots.some((root) => normalized.startsWith(root));
}

const FRAME_LINE =
  /^\s+at (?:(?<fn>[^()\n]{1,300}) \((?<inner>[^()\n]{1,520})\)|(?<bare>[^()\s]{1,520}))$/;
const LOCATION = /^(?<path>[^\s()]{1,500}):\d{1,7}:\d{1,7}$/;

export function isTrustedFrameLine(line: string): boolean {
  const groups = FRAME_LINE.exec(line)?.groups;
  if (!groups) return false;
  if (!isTrustedFunctionName(groups.fn)) return false;
  const location = groups.inner ?? groups.bare ?? '';
  if (groups.fn !== undefined && (location === '<anonymous>' || location === 'native')) return true;
  return isTrustedServerPath(LOCATION.exec(location)?.groups?.path);
}

export function isTrustedServerFrame(frame: StackFrame): boolean {
  return (
    typeof frame.lineno === 'number' &&
    isTrustedServerPath(frame.abs_path ?? frame.filename) &&
    (frame.filename === undefined || isTrustedServerPath(frame.filename)) &&
    isTrustedFunctionName(frame.function)
  );
}

/** Cadres de confiance d'une erreur, sans son en-tête `Nom: message`. */
export function stackFrames(error: Error): string[] {
  const stack = typeof error.stack === 'string' ? error.stack : '';
  const message = typeof error.message === 'string' ? error.message : '';
  const end = message ? stack.indexOf(message) : -1;
  const body = end >= 0 ? stack.slice(end + message.length) : stack;
  return body.split('\n').filter(isTrustedFrameLine);
}

/** Pile réduite à ses cadres de confiance, pour l'analyseur de pile de Sentry. */
export function trustedStack(stack: string): string {
  return ['Error', ...stack.split('\n').filter(isTrustedFrameLine)].join('\n');
}

const MAX_CAUSE_DEPTH = 5;

/** Copie d'une erreur réduite à son type, son code et ses cadres, causes comprises. */
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
