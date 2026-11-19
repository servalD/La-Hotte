import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaProductRepository } from '../../src/modules/catalog/infrastructure/prisma-product-repository';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile } from '../support/sign-in';

// Catalogue global en base : MOD-05 (une page une fois, comptée par compte), MOD-06 (retour en
// file après une modification), VIS-40 (recherche plein texte paramétrée).

let app: INestApplication;
let prisma: PrismaService;
let repository: PrismaProductRepository;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  repository = new PrismaProductRepository(prisma);
});

afterAll(async () => {
  await app.close();
});

async function published(
  ownerProfileId: string,
  input: { url: string | null; title: string; status?: 'APPROVED' | 'PENDING' },
): Promise<string> {
  const id = randomUUID();
  await prisma.product.create({
    data: {
      id,
      ownerProfileId,
      title: input.title,
      currency: 'EUR',
      source: 'LINK',
      sourceUrl: input.url,
      normalizedUrl: input.url,
      shareLevel: 'GLOBAL',
      moderationStatus: input.status ?? 'APPROVED',
      extractionStatus: 'DONE',
    },
  });
  return id;
}

describe('Catalogue global (MOD-05, MOD-06, VIS-40)', () => {
  it('une page une seule fois, la plus ancienne, comptée par compte et non par profil', async () => {
    const tag = randomUUID();
    const url = `https://boutique.example/${tag}`;
    const a = await createAccountWithProfile(prisma);
    const b = await createAccountWithProfile(prisma);
    // Second profil du compte a : il ne compte pas une personne de plus.
    const sibling = randomUUID();
    await prisma.profile.create({
      data: {
        id: sibling,
        accountId: a.accountId,
        displayName: 'Autre profil',
        accentColor: '#336699',
        locale: 'fr',
        currency: 'EUR',
        timezone: 'Europe/Paris',
      },
    });
    const first = await published(a.profileId, { url, title: `Tente ${tag}` });
    await published(sibling, { url, title: `Tente ${tag}` });
    await published(b.profileId, { url, title: `Tente ${tag}` });
    await published(b.profileId, { url, title: `Tente ${tag}`, status: 'PENDING' });
    const entries = (await repository.findGlobal({ query: tag, limit: 50 })).filter(
      (e) => e.product.sourceUrl === url,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.product.id).toBe(first);
    expect(entries[0]?.adopters).toBe(2);
    // Revue SEC-40, 4a : toutes les fiches publiées de l'adresse, la plus ancienne d'abord, pour
    // que le compteur se recalcule par lecteur (REP-10).
    expect(entries[0]?.members.map((m) => m.ownerProfileId)).toEqual([
      a.profileId,
      sibling,
      b.profileId,
    ]);
    expect(entries[0]?.members.map((m) => m.accountId)).toEqual([
      a.accountId,
      a.accountId,
      b.accountId,
    ]);
    expect(entries[0]?.members[0]?.productId).toBe(first);
  });

  it('une fiche sans adresse reste seule, et une fiche en attente n’apparaît pas', async () => {
    const tag = randomUUID();
    const owner = await createAccountWithProfile(prisma);
    const manual = await published(owner.profileId, { url: null, title: `Pull ${tag}` });
    await published(owner.profileId, { url: null, title: `Pull ${tag}`, status: 'PENDING' });
    const ids = (await repository.findGlobal({ query: tag, limit: 50 })).map((e) => e.product.id);
    expect(ids).toEqual([manual]);
  });

  it('modifier le contenu d’une fiche approuvée la remet en file', async () => {
    const owner = await createAccountWithProfile(prisma);
    const id = await published(owner.profileId, {
      url: `https://boutique.example/${randomUUID()}`,
      title: 'Lampe',
    });
    const updated = await repository.update({
      ownerProfileId: owner.profileId,
      productId: id,
      expectedVersion: 1,
      changes: { title: 'Lampe de chevet' },
    });
    expect(updated).not.toBe('version');
    expect((await prisma.product.findUniqueOrThrow({ where: { id } })).moderationStatus).toBe(
      'PENDING',
    );
  });
});
