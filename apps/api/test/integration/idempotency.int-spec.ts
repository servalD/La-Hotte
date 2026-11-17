import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import {
  IDEMPOTENCY_STALE_MS,
  IdempotencyStore,
  IdempotencyInProgressError,
  IdempotencyKeyReusedError,
} from '../../src/platform/http/idempotency';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile } from '../support/sign-in';

// API-16, OFF-19 (ADR 0020) : réservation de clé contre PostgreSQL réel, concurrence comprise.

let app: INestApplication;
let prisma: PrismaService;
let store: IdempotencyStore;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  store = app.get(IdempotencyStore);
});

afterAll(async () => {
  await app.close();
});

async function profile(): Promise<string> {
  return (await createAccountWithProfile(prisma)).profileId;
}

describe('PrismaIdempotencyStore', () => {
  it('une seule réservation parmi des essais simultanés ; les autres attendent (409)', async () => {
    const profileId = await profile();
    const key = randomUUID();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => store.begin({ profileId, key, requestHash: 'a'.repeat(64) })),
    );
    const ran = results.filter((r) => r.status === 'fulfilled' && r.value.kind === 'run');
    expect(ran).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect(r.reason).toBeInstanceOf(IdempotencyInProgressError);
    }
  });

  it('réponse enregistrée rejouée ; autre requête sous la même clé refusée', async () => {
    const profileId = await profile();
    const key = randomUUID();
    const begun = await store.begin({ profileId, key, requestHash: 'b'.repeat(64) });
    if (begun.kind !== 'run') throw new Error('réservation attendue');
    await store.complete(begun.id, 201, { id: 'x', title: 'Vélo' });
    expect(await store.begin({ profileId, key, requestHash: 'b'.repeat(64) })).toEqual({
      kind: 'replay',
      body: { id: 'x', title: 'Vélo' },
    });
    await expect(
      store.begin({ profileId, key, requestHash: 'c'.repeat(64) }),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
    // Réponse sans corps (204) : rejouée telle quelle.
    const empty = await store.begin({ profileId, key: randomUUID(), requestHash: 'd'.repeat(64) });
    if (empty.kind !== 'run') throw new Error('réservation attendue');
    await store.complete(empty.id, 204, undefined);
    const row = await prisma.idempotencyRecord.findUniqueOrThrow({ where: { id: empty.id } });
    expect(row.response).toEqual({ body: null });
  });

  it('échec libéré : la clé redevient libre ; réservation abandonnée reprise après 2 minutes', async () => {
    const profileId = await profile();
    const key = randomUUID();
    const first = await store.begin({ profileId, key, requestHash: 'e'.repeat(64) });
    if (first.kind !== 'run') throw new Error('réservation attendue');
    await store.release(first.id);
    const second = await store.begin({ profileId, key, requestHash: 'e'.repeat(64) });
    expect(second.kind).toBe('run');
    if (second.kind !== 'run') return;
    await prisma.idempotencyRecord.update({
      where: { id: second.id },
      data: { createdAt: new Date(Date.now() - IDEMPOTENCY_STALE_MS - 1_000) },
    });
    const taken = await store.begin({ profileId, key, requestHash: 'e'.repeat(64) });
    expect(taken).toEqual({ kind: 'run', id: second.id });
  });

  it('M4 : les clés échues sont purgées, les autres restent', async () => {
    const profileId = await profile();
    const old = await store.begin({ profileId, key: randomUUID(), requestHash: 'f'.repeat(64) });
    const kept = await store.begin({ profileId, key: randomUUID(), requestHash: 'f'.repeat(64) });
    if (old.kind !== 'run' || kept.kind !== 'run') throw new Error('réservations attendues');
    await prisma.idempotencyRecord.update({
      where: { id: old.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect(await store.purgeExpired(new Date())).toBeGreaterThanOrEqual(1);
    expect(await prisma.idempotencyRecord.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.idempotencyRecord.findUnique({ where: { id: kept.id } })).not.toBeNull();
  });
});
