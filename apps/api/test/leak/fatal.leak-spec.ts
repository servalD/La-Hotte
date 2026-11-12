import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inject } from 'vitest';
import { ALLOWED_EVENT_KEYS, envelopeEvents, findMarker, MARKER } from './markers';
import { fetchRecords, type ReceivedRecord, resetRecords } from './receivers';

/**
 * OBS-26, volet B, OBS-45 : exceptions et rejets non gérés dans un vrai processus, chargé par
 * `dist/instrument.js` comme l'API en production. Rien du marqueur sur la sortie d'erreur, la
 * sortie standard, les spans ni l'événement d'erreur ; une seule capture ; sortie en code 1.
 */

const receiverUrl = inject('receiverUrl');
const instrument = join(__dirname, '..', '..', 'dist', 'instrument.js');
const child = join(__dirname, 'fixtures', 'fatal-child.mjs');

interface ChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runChild(mode: 'uncaught' | 'rejection'): Promise<ChildResult> {
  // Répertoire vide : `instrument.js` n'y trouve aucun `.env` qui changerait la configuration.
  const cwd = mkdtempSync(join(tmpdir(), 'leak-fatal-'));
  const { host } = new URL(receiverUrl);
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--enable-source-maps', '--import', pathToFileURL(instrument).href, child, mode, MARKER],
      {
        cwd,
        timeout: 20_000,
        env: {
          PATH: process.env.PATH,
          SYSTEMROOT: process.env.SYSTEMROOT,
          OTEL_EXPORTER_OTLP_ENDPOINT: receiverUrl,
          SENTRY_DSN: `http://publickey@${host}/1`,
          DEPLOY_ENVIRONMENT: 'preview',
          TRACES_SAMPLE_RATIO: '1',
        },
      },
      (error, stdout, stderr) => {
        rmSync(cwd, { recursive: true, force: true });
        const code = error ? (typeof error.code === 'number' ? error.code : null) : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

function errorEvents(records: ReceivedRecord[]): Record<string, unknown>[] {
  return records
    .filter((record) => record.channel === 'errors')
    .flatMap((record) => envelopeEvents(record.body));
}

beforeAll(() => {
  if (!existsSync(instrument)) {
    throw new Error('dist/instrument.js absent : lancer `pnpm test:leak`, qui construit d’abord');
  }
});

describe.each(['uncaught', 'rejection'] as const)('OBS-26, OBS-45 erreur fatale (%s)', (mode) => {
  let result: ChildResult;
  let records: ReceivedRecord[];

  beforeAll(async () => {
    await resetRecords(receiverUrl);
    result = await runChild(mode);
    records = await fetchRecords(receiverUrl);
  }, 30_000);

  it('sort en code 1', () => {
    expect(result.code).toBe(1);
  });

  it('sortie d’erreur : une ligne nettoyée, rien du marqueur', () => {
    expect(result.stderr).toContain('"msg":"Erreur fatale"');
    expect(result.stderr).toContain('"type":"TypeError"');
    expect(findMarker(result.stderr)).toBeUndefined();
    expect(findMarker(result.stdout)).toBeUndefined();
  });

  it('le SDK ne reçoit qu’une copie nettoyée (sanitizeError)', () => {
    const handed = result.stdout.split('\n').filter((line) => line.startsWith('SDK-RECU:'));
    expect(handed, result.stdout + result.stderr).toHaveLength(1);
    expect(findMarker(handed.join('\n'))).toBeUndefined();
  });

  it('un seul événement d’erreur, sans marqueur', () => {
    const events = errorEvents(records);
    expect(events).toHaveLength(1);
    const keys = Object.keys(events[0] ?? {});
    expect(keys.filter((key) => !ALLOWED_EVENT_KEYS.has(key))).toEqual([]);
    const errors = records.filter((r) => r.channel === 'errors').map((r) => r.body);
    expect(errors.join('\n')).toContain('TypeError');
    expect(findMarker(errors.join('\n'))).toBeUndefined();
  });

  // OpenTelemetry n'exporte que les spans terminés : la fixture termine le sien avant l'erreur.
  // Sans le vidage du gestionnaire fatal, il serait perdu : le lot part au plus tôt après 5 s, le
  // processus sort au plus tard après 3 s (OBS-45).
  it('le span est vidé avant la sortie, sans marqueur', () => {
    const traces = records.filter((r) => r.channel === 'traces').map((r) => r.body);
    expect(traces.join('\n')).toContain('fatal-test');
    expect(findMarker(traces.join('\n'))).toBeUndefined();
  });

  it('aucun marqueur nulle part', () => {
    expect(findMarker(records.map((record) => record.body).join('\n'))).toBeUndefined();
  });
});
