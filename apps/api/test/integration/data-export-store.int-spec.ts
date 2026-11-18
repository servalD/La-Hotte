import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaDataExportStore } from '../../src/modules/privacy/infrastructure/data-export-store';
import { AppConfig } from '../../src/platform/config/env';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile } from '../support/sign-in';

// RGPD-11, SEC-22 : fichier d'export chiffré au repos, lié à son profil, rendu une seule fois.

let app: INestApplication;
let prisma: PrismaService;
let store: PrismaDataExportStore;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  store = new PrismaDataExportStore(prisma, app.get(AppConfig));
});

afterAll(async () => {
  await app.close();
});

describe('Fichier d’export (RGPD-11, SEC-22)', () => {
  it('chiffré en base, rendu une fois au seul profil, effacé ensuite', async () => {
    const owner = await createAccountWithProfile(prisma);
    const other = await createAccountWithProfile(prisma);
    const id = randomUUID();
    const now = new Date();
    const payload = JSON.stringify({ secret: 'marqueur-en-clair-7f3a' });
    await store.create({
      id,
      profileId: owner.profileId,
      requestedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
      payload,
    });
    const row = await prisma.exportRequest.findUniqueOrThrow({ where: { id } });
    expect(Buffer.from(row.payloadEnc ?? []).toString('utf8')).not.toContain('marqueur-en-clair');
    expect(await store.take({ id, profileId: other.profileId, now })).toBeNull();
    expect(await store.take({ id, profileId: owner.profileId, now })).toBe(payload);
    expect(await store.take({ id, profileId: owner.profileId, now })).toBeNull();
    expect((await prisma.exportRequest.findUniqueOrThrow({ where: { id } })).payloadEnc).toBeNull();
    expect(await store.lastRequestedAt(owner.profileId)).toEqual(now);
  });

  it('un fichier échu est effacé sans avoir été lu', async () => {
    const owner = await createAccountWithProfile(prisma);
    const id = randomUUID();
    const past = new Date(Date.now() - 2 * 3_600_000);
    await store.create({
      id,
      profileId: owner.profileId,
      requestedAt: past,
      expiresAt: new Date(past.getTime() + 3_600_000),
      payload: '{}',
    });
    expect(await store.purge(new Date())).toBeGreaterThanOrEqual(1);
    expect(await store.take({ id, profileId: owner.profileId, now: past })).toBeNull();
  });
});
