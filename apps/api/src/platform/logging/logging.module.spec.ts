import { Writable } from 'node:stream';
import pinoHttp from 'pino-http';
import { serializeLoggedError } from './logging.module';

const MARKER = 'MARQUEUR-JOURNAL';

function capture(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('sérialiseur err à travers pino-http (OBS-01, OBS-45)', () => {
  // Régression du 2026-11-12 : pino-http enveloppe le sérialiseur, qui recevait un objet simple
  // et journalisait `{"type":"object"}`, sans type ni pile.
  it('journalise type, code et cadres de l’erreur d’origine, jamais le message', () => {
    const { stream, lines } = capture();
    const http = pinoHttp({ serializers: { err: serializeLoggedError } }, stream);
    const error = Object.assign(new TypeError(`échec ${MARKER}`), { code: 'P2002' });

    http.logger.error({ err: error }, 'Erreur inattendue');

    const [line] = lines();
    const err = line?.err as { type?: string; code?: string; stack?: string };
    expect(err.type).toBe('TypeError');
    expect(err.code).toBe('P2002');
    expect(err.stack).toMatch(/^\s+at /);
    expect(JSON.stringify(line)).not.toContain(MARKER);
  });
});
