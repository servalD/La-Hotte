import * as Sentry from '@sentry/nestjs';
import { activeTraceIds } from './correlation';
import { sanitizeError, scrubError } from './scrub';

/** Au-delà, on sort sans attendre la fin du vidage (GlitchTip ou collecteur bloqués). */
const EXIT_GUARD_MS = 3000;

/** Ligne écrite quand l'erreur elle-même empêche de la décrire (getter qui lève, `Proxy`). */
const FALLBACK_LINE = '{"level":60,"msg":"Erreur fatale","err":{"type":"unknown"}}\n';

export type FatalMechanism = 'auto.node.onuncaughtexception' | 'auto.node.onunhandledrejection';

export interface FatalDependencies {
  write: (line: string) => void;
  capture: (error: Error, mechanism: FatalMechanism) => void;
  /** Vide Sentry et OpenTelemetry (`shutdownTelemetry`). */
  flush: () => Promise<unknown>;
  exit: (code: number) => void;
  schedule: (callback: () => void, delayMs: number) => void;
}

function describeFatal(error: unknown): string {
  try {
    return `${JSON.stringify({
      level: 60,
      time: Date.now(),
      msg: 'Erreur fatale',
      err: scrubError(error),
      ...activeTraceIds(),
    })}\n`;
  } catch {
    return FALLBACK_LINE;
  }
}

/**
 * Erreurs fatales (exception ou rejet non géré), OBS-45. Les intégrations du SDK ne sont pas
 * utilisées : elles lui transmettent l'erreur d'origine, et après une première erreur fatale, la
 * suivante est écrite brute sur la sortie d'erreur (revue de sécurité du 2026-11-12). Ici :
 * - chaque erreur donne une ligne de journal nettoyée, ou une ligne fixe si l'erreur est hostile ;
 * - la première seulement part vers GlitchTip, en copie nettoyée (`sanitizeError`) ;
 * - le processus sort en code 1 une fois l'envoi vidé, ou au plus tard après `EXIT_GUARD_MS`.
 * Le gestionnaire ne lève jamais : sinon Node écrirait la nouvelle erreur brute.
 */
export function createFatalHandler(deps: FatalDependencies) {
  let exiting = false;
  const exitOnce = (() => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      deps.exit(1);
    };
  })();

  return (error: unknown, mechanism: FatalMechanism): void => {
    try {
      deps.write(describeFatal(error));
    } catch {
      // Sortie d'erreur indisponible : rien d'autre à tenter.
    }
    if (exiting) return;
    exiting = true;
    deps.schedule(exitOnce, EXIT_GUARD_MS);
    try {
      deps.capture(sanitizeError(error), mechanism);
    } catch {
      // Erreur hostile ou SDK en échec : on sort quand même.
    }
    let flushing: Promise<unknown>;
    try {
      flushing = deps.flush();
    } catch {
      flushing = Promise.resolve();
    }
    void flushing.finally(exitOnce);
  };
}

export function captureFatal(error: Error, mechanism: FatalMechanism): void {
  Sentry.captureException(error, {
    mechanism: { type: mechanism, handled: false },
    captureContext: { level: 'fatal' },
  });
}

type ProcessOn = (
  event: 'uncaughtException' | 'unhandledRejection',
  listener: (error: unknown) => void,
) => void;

/**
 * Branche le gestionnaire sur le processus. Un écouteur présent : Node ne sort plus de lui-même,
 * c'est le gestionnaire qui sort. Sans Sentry, la capture ne fait rien et seule la ligne nettoyée
 * est écrite.
 */
export function installFatalHandlers(
  overrides: Partial<FatalDependencies> & Pick<FatalDependencies, 'flush'>,
  on: ProcessOn = (event, listener) => {
    process.on(event, listener);
  },
): void {
  const handle = createFatalHandler({
    write: (line) => process.stderr.write(line),
    capture: captureFatal,
    exit: (code) => process.exit(code),
    schedule: (callback, delayMs) => {
      // Pas d'`unref` : le minuteur doit garantir la sortie.
      setTimeout(callback, delayMs);
    },
    ...overrides,
  });
  on('uncaughtException', (error) => {
    handle(error, 'auto.node.onuncaughtexception');
  });
  on('unhandledRejection', (reason) => {
    handle(reason, 'auto.node.onunhandledrejection');
  });
}
