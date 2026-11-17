import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile, signIn, type SignedIn } from '../support/sign-in';

// Contraintes de la compta en base (DAT-01, DAT-02, CPT-53 à CPT-73, ADR 0019).

let app: INestApplication;
let prisma: PrismaService;
let user: SignedIn;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  const { accountId, profileId } = await createAccountWithProfile(prisma);
  user = await signIn(app, { accountId, profileId });
});

afterAll(async () => {
  await app.close();
});

const http = () => request(app.getHttpServer());

async function newList(): Promise<string> {
  const list = await http()
    .post('/api/v1/lists')
    .set(user.mutation)
    .send({ type: 'WISHLIST', title: 'Noël', recipientIds: [user.profileId] })
    .expect(201);
  return list.body.id as string;
}

async function newItem(listId?: string): Promise<{ itemId: string; listId: string }> {
  const target = listId ?? (await newList());
  const product = await http()
    .post('/api/v1/products')
    .set(user.mutation)
    .send({ title: 'Robot pâtissier' })
    .expect(201);
  const item = await http()
    .post(`/api/v1/lists/${target}/items`)
    .set(user.mutation)
    .send({ productId: product.body.id as string })
    .expect(201);
  return { itemId: item.body.id as string, listId: target };
}

async function accounting(itemId: string): Promise<string> {
  const id = randomUUID();
  await prisma.itemAccounting.create({
    data: { id, itemId, currency: 'EUR', plannedTotalMinor: 10_000n },
  });
  return id;
}

function contribution(
  accountingId: string,
  data: Partial<Prisma.ContributionUncheckedCreateInput> = {},
) {
  return prisma.contribution.create({
    data: {
      id: randomUUID(),
      accountingId,
      profileId: user.profileId,
      mode: 'FIXED',
      amountMinor: 1_000n,
      rank: 1,
      ...data,
    },
  });
}

describe('Compta en base (DAT-01)', () => {
  it('CPT-53 : une fraction exacte, présente si et seulement si pourcentage', async () => {
    const { itemId } = await newItem();
    const id = await accounting(itemId);
    await expect(
      contribution(id, { mode: 'PERCENT', shareNum: 1, shareDen: 3, amountMinor: 3_333n }),
    ).resolves.toBeDefined();
    await prisma.contribution.deleteMany({ where: { accountingId: id } });
    await expect(contribution(id, { mode: 'PERCENT', amountMinor: 1n })).rejects.toThrow();
    await expect(contribution(id, { shareNum: 1, shareDen: 3 })).rejects.toThrow();
    await expect(
      contribution(id, { mode: 'PERCENT', shareNum: 4, shareDen: 3, amountMinor: 1n }),
    ).rejects.toThrow();
    await expect(
      contribution(id, { mode: 'PERCENT', shareNum: 1, shareDen: 10_001, amountMinor: 1n }),
    ).rejects.toThrow();
  });

  it('CPT-55 : montant inconnu seulement en Tout ; jamais négatif', async () => {
    const { itemId } = await newItem();
    const id = await accounting(itemId);
    await expect(contribution(id, { amountMinor: null })).rejects.toThrow();
    await expect(contribution(id, { amountMinor: -1n })).rejects.toThrow();
    await expect(contribution(id, { settledMinor: -1n })).rejects.toThrow();
    await expect(contribution(id, { mode: 'FULL', amountMinor: null })).resolves.toBeDefined();
  });

  it('CPT-56 : exemplaires seulement en montant fixe', async () => {
    const { itemId } = await newItem();
    const id = await accounting(itemId);
    await expect(contribution(id, { mode: 'FULL', units: 2 })).rejects.toThrow();
    await expect(contribution(id, { units: 0 })).rejects.toThrow();
    await expect(contribution(id, { units: 2 })).resolves.toBeDefined();
  });

  it('une participation par profil et par fiche ; rangs uniques', async () => {
    const { itemId } = await newItem();
    const id = await accounting(itemId);
    await contribution(id);
    await expect(contribution(id, { rank: 2 })).rejects.toThrow();
    await expect(contribution(id, { profileId: null })).rejects.toThrow();
  });

  it('CPT-58, CPT-61 : une seule demande en attente', async () => {
    const { itemId } = await newItem();
    const id = await accounting(itemId);
    const review = (status: 'PENDING' | 'REFUSED') =>
      prisma.accountingReview.create({
        data: { id: randomUUID(), accountingId: id, kind: 'COST', proposed: {}, status },
      });
    await review('PENDING');
    await expect(review('PENDING')).rejects.toThrow();
    await expect(review('REFUSED')).resolves.toBeDefined();
    const buyer = () =>
      prisma.buyerRequest.create({
        data: { id: randomUUID(), accountingId: id, candidateProfileId: user.profileId! },
      });
    await buyer();
    await expect(buyer()).rejects.toThrow();
  });

  it('CPT-68 : une proposition de compensation en attente par paire et par devise', async () => {
    const other = await createAccountWithProfile(prisma);
    const propose = (from: string, to: string, currency = 'EUR') =>
      prisma.offsetProposal.create({
        data: {
          id: randomUUID(),
          proposerProfileId: from,
          counterpartProfileId: to,
          currency,
          snapshot: {},
        },
      });
    await propose(user.profileId!, other.profileId);
    await expect(propose(other.profileId, user.profileId!)).rejects.toThrow();
    await expect(propose(user.profileId!, other.profileId, 'CHF')).resolves.toBeDefined();
    await expect(propose(user.profileId!, user.profileId!, 'USD')).rejects.toThrow();
  });

  it('CPT-69 : budget positif, un par événement et par destinataire, même sans destinataire', async () => {
    const event = await http()
      .post('/api/v1/events')
      .set(user.mutation)
      .send({ title: 'Noël', date: '2026-12-24', type: 'CHRISTMAS', mode: 'EXCHANGE' })
      .expect(201);
    const budget = (amountMinor: bigint) =>
      prisma.budget.create({
        data: {
          id: randomUUID(),
          profileId: user.profileId!,
          eventId: event.body.id as string,
          amountMinor,
          currency: 'EUR',
        },
      });
    await expect(budget(0n)).rejects.toThrow();
    await budget(30_000n);
    await expect(budget(20_000n)).rejects.toThrow();
  });
});

describe('Compta détachable (CPT-73, ADR 0019)', () => {
  it('supprimer l’élément réussit ; la fiche garde son titre et sa compta', async () => {
    const { itemId } = await newItem();
    const id = await accounting(itemId);
    await contribution(id);
    await http().delete(`/api/v1/items/${itemId}`).set(user.mutation).expect(204);
    const row = await prisma.itemAccounting.findUniqueOrThrow({ where: { id } });
    expect(row.itemId).toBeNull();
    expect(row.detachedTitle).toBe('Robot pâtissier');
    expect(row.detachedAt).not.toBeNull();
    expect(await prisma.contribution.count({ where: { accountingId: id } })).toBe(1);
  });

  it('purger la liste réussit ; l’événement de la liste est relevé', async () => {
    const event = await http()
      .post('/api/v1/events')
      .set(user.mutation)
      .send({ title: 'Noël', date: '2026-12-24', type: 'CHRISTMAS', mode: 'EXCHANGE' })
      .expect(201);
    const eventId = event.body.id as string;
    const listId = await newList();
    await prisma.list.update({ where: { id: listId }, data: { eventId } });
    const { itemId } = await newItem(listId);
    const id = await accounting(itemId);
    await prisma.list.delete({ where: { id: listId } });
    const row = await prisma.itemAccounting.findUniqueOrThrow({ where: { id } });
    expect(row.itemId).toBeNull();
    expect(row.detachedEventId).toBe(eventId);
    expect(row.detachedTitle).toBe('Robot pâtissier');
  });

  it('une fiche ne se détache pas à la main sans date', async () => {
    const { itemId } = await newItem();
    const id = await accounting(itemId);
    await expect(
      prisma.itemAccounting.update({ where: { id }, data: { itemId: null } }),
    ).rejects.toThrow();
  });
});

describe('Journal de compta (DAT-02, CPT-50)', () => {
  it('le rôle applicatif ne peut ni modifier ni supprimer ledger_entry', async () => {
    const { itemId } = await newItem();
    const accountingId = await accounting(itemId);
    const appRole = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    try {
      const id = randomUUID();
      await appRole.ledgerEntry.create({
        data: { id, accountingId, kind: 'CONTRIBUTION_SET', operationId: randomUUID() },
      });
      await expect(
        appRole.$executeRaw(Prisma.sql`UPDATE ledger_entry SET kind = 'X' WHERE id = ${id}::uuid`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        appRole.$executeRaw(Prisma.sql`DELETE FROM ledger_entry WHERE id = ${id}::uuid`),
      ).rejects.toThrow(/permission denied/);
      // Une fiche journalisée n'est jamais supprimée.
      await expect(
        appRole.itemAccounting.delete({ where: { id: accountingId } }),
      ).rejects.toThrow();
    } finally {
      await appRole.$disconnect();
    }
  });
});
