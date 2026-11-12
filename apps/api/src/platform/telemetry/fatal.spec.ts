import {
  createFatalHandler,
  type FatalDependencies,
  type FatalMechanism,
  installFatalHandlers,
} from './fatal';

const MARKER = 'MARQUEUR-FATAL';

function setup(overrides: Partial<FatalDependencies> = {}) {
  const lines: string[] = [];
  const captured: { error: Error; mechanism: FatalMechanism }[] = [];
  const exits: number[] = [];
  const scheduled: { callback: () => void; delayMs: number }[] = [];
  const deps: FatalDependencies = {
    write: (line) => lines.push(line),
    capture: (error, mechanism) => captured.push({ error, mechanism }),
    // Par défaut, un vidage qui ne se termine jamais (GlitchTip bloqué).
    flush: () => new Promise(() => {}),
    exit: (code) => exits.push(code),
    schedule: (callback, delayMs) => scheduled.push({ callback, delayMs }),
    ...overrides,
  };
  return { deps, handle: createFatalHandler(deps), lines, captured, exits, scheduled };
}

const nextTick = () => new Promise((resolve) => setImmediate(resolve));

/** Erreur dont la description lève : getters `stack`, `name` et `cause` piégés. */
function hostileError(): Error {
  const error = new Error(MARKER);
  for (const key of ['stack', 'name', 'cause']) {
    Object.defineProperty(error, key, {
      get() {
        throw new Error(`piège ${MARKER}`);
      },
    });
  }
  return error;
}

describe('erreurs fatales (OBS-45)', () => {
  // Contre-revue du 2026-11-12 : pendant le vidage vers GlitchTip, une seconde exception non
  // gérée était écrite brute (message compris) sur la sortie d'erreur par le SDK.
  it('deux exceptions pendant le vidage : deux lignes nettoyées, une seule capture', () => {
    const { handle, lines, captured, exits } = setup();

    handle(new Error(`première ${MARKER}`), 'auto.node.onuncaughtexception');
    handle(new TypeError(`seconde ${MARKER}`), 'auto.node.onuncaughtexception');

    expect(lines).toHaveLength(2);
    expect(lines.join('')).not.toContain(MARKER);
    expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({ level: 60, err: { type: 'TypeError' } });
    expect(captured).toHaveLength(1);
    expect(exits).toEqual([]);
  });

  it('le SDK ne reçoit qu’une copie nettoyée', () => {
    const { handle, captured } = setup();
    const cause = new RangeError(`cause ${MARKER}`);

    handle(
      Object.assign(new Error(MARKER, { cause }), { query: MARKER }),
      'auto.node.onunhandledrejection',
    );

    const [first] = captured;
    expect(first?.mechanism).toBe('auto.node.onunhandledrejection');
    expect(first?.error.message).toBe('');
    expect(Object.keys(first?.error ?? {})).not.toContain('query');
    expect(`${first?.error.stack}${(first?.error.cause as Error).stack}`).not.toContain(MARKER);
  });

  it('sort en code 1 une fois l’envoi vidé, même si le vidage échoue', async () => {
    const { handle, exits } = setup({
      flush: () => Promise.reject(new Error('GlitchTip injoignable')),
    });

    // Régression vue en CI le 2026-11-12 : `flush().finally(…)` produisait un rejet non géré.
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', record);
    try {
      handle(`rejet par une chaîne ${MARKER}`, 'auto.node.onunhandledrejection');
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off('unhandledRejection', record);
    }

    expect(exits).toEqual([1]);
    expect(unhandled).toEqual([]);
  });

  // Troisième passe de revue : `Sentry.close` qui ne se résout jamais laissait le processus
  // servir dans un état inconnu.
  it('minuteur de garde : sortie même si le vidage ne se termine jamais, une seule fois', async () => {
    const { handle, exits, scheduled } = setup();

    handle(new Error(MARKER), 'auto.node.onuncaughtexception');
    await nextTick();
    expect(exits).toEqual([]);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delayMs).toBeLessThanOrEqual(5000);

    scheduled[0]?.callback();
    scheduled[0]?.callback();
    expect(exits).toEqual([1]);
  });

  // Troisième passe de revue : une erreur hostile faisait lever le gestionnaire, et Node
  // écrivait alors la nouvelle erreur brute.
  it('erreur hostile : ne lève pas, écrit une ligne fixe, sort quand même', async () => {
    const { handle, lines, exits } = setup({ flush: () => Promise.resolve() });

    expect(() => {
      handle(hostileError(), 'auto.node.onuncaughtexception');
    }).not.toThrow();
    await nextTick();

    expect(lines.join('')).not.toContain(MARKER);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ level: 60, msg: 'Erreur fatale' });
    expect(exits).toEqual([1]);
  });

  it('capture ou vidage qui lèvent : sortie quand même', async () => {
    const { handle, exits } = setup({
      capture: () => {
        throw new Error('SDK en échec');
      },
      flush: () => {
        throw new Error('vidage en échec');
      },
    });

    expect(() => {
      handle(new Error(MARKER), 'auto.node.onuncaughtexception');
    }).not.toThrow();
    await nextTick();

    expect(exits).toEqual([1]);
  });

  it('installFatalHandlers branche les deux événements du processus', () => {
    const listeners = new Map<string, (error: unknown) => void>();
    const { deps, captured } = setup();

    installFatalHandlers(deps, (event, listener) => listeners.set(event, listener));
    listeners.get('uncaughtException')?.(new Error(MARKER));

    expect([...listeners.keys()].sort()).toEqual(['uncaughtException', 'unhandledRejection']);
    expect(captured).toEqual([
      { error: expect.any(Error) as Error, mechanism: 'auto.node.onuncaughtexception' },
    ]);
  });
});
