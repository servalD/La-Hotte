import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { brotliDecompress, gunzip, inflate } from 'node:zlib';
import type { TestProject } from 'vitest/node';

/**
 * Faux collecteur OTLP et faux GlitchTip (OBS-26). Tournent dans le processus principal de
 * Vitest, hors de l'application testée : ils ne sont ni tracés ni nettoyés. Ils enregistrent
 * tout ce qui sort réellement des exporteurs, corps décompressé.
 */

export type Channel = 'traces' | 'metrics' | 'logs' | 'errors' | 'other';

export interface ReceivedRecord {
  channel: Channel;
  path: string;
  body: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    receiverUrl: string;
  }
}

const decoders: Record<string, (input: Buffer) => Promise<Buffer>> = {
  gzip: promisify(gunzip),
  deflate: promisify(inflate),
  br: promisify(brotliDecompress),
};

function channelOf(path: string): Channel {
  if (path.startsWith('/v1/traces')) return 'traces';
  if (path.startsWith('/v1/metrics')) return 'metrics';
  if (path.startsWith('/v1/logs')) return 'logs';
  if (/^\/api\/\d+\/(envelope|store)\//.test(path)) return 'errors';
  return 'other';
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks);
  const encoding = request.headers['content-encoding'];
  const decode = typeof encoding === 'string' ? decoders[encoding] : undefined;
  return (decode ? await decode(raw) : raw).toString('utf8');
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let records: ReceivedRecord[] = [];

  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    if (request.method === 'GET' && path === '/_records') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(records));
      return;
    }
    if (request.method === 'POST' && path === '/_reset') {
      records = [];
      response.end();
      return;
    }
    readBody(request)
      .then((body) => {
        records.push({ channel: channelOf(path), path, body });
        response.setHeader('content-type', 'application/json');
        response.end('{}');
      })
      .catch(() => {
        response.statusCode = 400;
        response.end();
      });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  project.provide('receiverUrl', `http://127.0.0.1:${port}`);

  return () =>
    new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
}

export async function fetchRecords(receiverUrl: string): Promise<ReceivedRecord[]> {
  const response = await fetch(`${receiverUrl}/_records`);
  return (await response.json()) as ReceivedRecord[];
}

export async function resetRecords(receiverUrl: string): Promise<void> {
  await fetch(`${receiverUrl}/_reset`, { method: 'POST' });
}
