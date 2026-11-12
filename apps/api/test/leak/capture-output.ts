/* eslint-disable no-console -- ce fichier intercepte `console` pour y chercher les marqueurs. */
import { inspect } from 'node:util';

/**
 * Tout ce que le processus écrit hors de pino pendant le scénario (OBS-26) : `console.*` (Prisma
 * avec `log`, un `console.error` oublié) et écritures directes sur la sortie standard ou d'erreur
 * (`ConsoleLogger` de Nest avant `useLogger`). En production, c'est le même flux que les
 * journaux. Dans un worker Vitest, `console` est remplacé et ne passe pas par `process.stderr` :
 * on intercepte donc les deux.
 */

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;

export const CAPTURE_PROBE = 'SONDE-DE-CAPTURE-OBS-26';

export interface OutputCapture {
  text: () => string;
  restore: () => void;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.message}\n${value.stack ?? ''}`;
  // Comme `console` lui-même : objets, `undefined`, références circulaires.
  return inspect(value, { depth: 8 });
}

type Write = (chunk: unknown, ...rest: unknown[]) => boolean;

export function captureOutput(): OutputCapture {
  const chunks: string[] = [];
  const restorers: Array<() => void> = [];

  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write;
    const passThrough = original.bind(stream) as Write;
    const intercept: Write = (chunk, ...rest) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      return passThrough(chunk, ...rest);
    };
    stream.write = intercept;
    restorers.push(() => {
      stream.write = original;
    });
  }

  for (const method of CONSOLE_METHODS) {
    const original = console[method];
    console[method] = (...args: unknown[]) => {
      chunks.push(args.map(stringify).join(' '));
      original.apply(console, args);
    };
    restorers.push(() => {
      console[method] = original;
    });
  }

  // Sondes : prouvent que chaque voie est bien interceptée (pas de faux vert).
  process.stdout.write(`${CAPTURE_PROBE}:stdout\n`);
  process.stderr.write(`${CAPTURE_PROBE}:stderr\n`);
  console.error(`${CAPTURE_PROBE}:console`);

  return {
    text: () => chunks.join('\n'),
    restore: () => {
      for (const restore of [...restorers].reverse()) restore();
    },
  };
}
