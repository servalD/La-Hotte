import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { ExtractionCache, ProductRepository } from '../../src/modules/catalog/testing';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile } from '../support/sign-in';

// Fiches en base : cache d'extraction (EXT-35), plafonds par profil et par compte (EXT-34),
// complétion qui ne touche qu'un brouillon en cours (EXT-06).

let app: INestApplication;
let prisma: PrismaService;
let products: ProductRepository;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  products = app.get(ProductRepository);
});

afterAll(async () => {
  await app.close();
});

async function draft(owner: string, startedAt: Date): Promise<string> {
  const id = randomUUID();
  await products.create({
    id,
    ownerProfileId: owner,
    title: 'shop.example',
    description: '',
    unitPriceMinor: null,
    currency: 'EUR',
    merchant: null,
    sourceUrl: 'https://shop.example/p',
    normalizedUrl: 'https://shop.example/p',
    source: 'LINK',
    imageKey: null,
    imageFromPhoto: false,
    extractionStatus: 'PENDING',
    extractionStartedAt: startedAt,
  });
  return id;
}

describe('Fiches en base', () => {
  it('EXT-35 : le cache expire ; une écriture remplace la précédente', async () => {
    const cache = app.get(ExtractionCache);
    const url = `https://shop.example/${randomUUID()}`;
    const value = {
      extraction: {
        title: 'Vélo',
        description: null,
        unitPriceMinor: 100,
        currency: 'EUR',
        merchant: null,
        imageUrl: null,
        uncertainFields: [],
      },
      imageKey: null,
      truncated: false,
    };
    const now = new Date();
    await cache.put({
      id: randomUUID(),
      normalizedUrl: url,
      value,
      expiresAt: new Date(now.getTime() + 1000),
    });
    expect(await cache.get(url, now)).toEqual(value);
    expect(await cache.get(url, new Date(now.getTime() + 2000))).toBeNull();
    await cache.put({
      id: randomUUID(),
      normalizedUrl: url,
      value: { ...value, truncated: true },
      expiresAt: new Date(now.getTime() + 5000),
    });
    expect((await cache.get(url, now))?.truncated).toBe(true);
  });

  it('EXT-34 : comptés par profil et par compte, dans leur fenêtre', async () => {
    const a = await createAccountWithProfile(prisma);
    const sibling = randomUUID();
    await prisma.profile.create({
      data: {
        id: sibling,
        accountId: a.accountId,
        displayName: 'Frère',
        accentColor: '#336699',
        locale: 'fr',
        currency: 'EUR',
        timezone: 'Europe/Paris',
      },
    });
    const now = Date.now();
    await draft(a.profileId, new Date(now - 10 * 60_000));
    await draft(a.profileId, new Date(now - 5 * 3600_000));
    await draft(sibling, new Date(now - 60_000));
    const counts = await products.countExtractionsSince({
      profileId: a.profileId,
      accountId: a.accountId,
      profileSince: new Date(now - 3600_000),
      accountSince: new Date(now - 24 * 3600_000),
    });
    expect(counts).toEqual({ profile: 1, account: 3 });
  });

  it('EXT-06 : la complétion ne touche qu’un brouillon en cours ; le balayage conclut les anciens', async () => {
    const { profileId } = await createAccountWithProfile(prisma);
    const id = await draft(profileId, new Date(Date.now() - 10 * 60_000));
    expect(
      await products.failStaleExtractions(new Date(Date.now() - 2 * 60_000)),
    ).toBeGreaterThanOrEqual(1);
    const late = await products.completeExtraction(id, {
      status: 'DONE',
      fields: { title: 'Trop tard' },
      imageKey: null,
      uncertainFields: [],
      truncated: false,
      priceCheckedAt: null,
    });
    expect(late).toBeNull();
    expect((await prisma.product.findUniqueOrThrow({ where: { id } })).extractionStatus).toBe(
      'FAILED',
    );
  });
});
