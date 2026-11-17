import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { RunSettlementTasks } from '../../src/modules/accounting/application/contract';
import { EventEngagements } from '../../src/modules/events/testing';
import { replay, type LedgerRecord } from '../../src/modules/accounting/domain/ledger';
import { InProcessAppEvents } from '../../src/platform/events/in-process-app-events';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile, signIn, type SignedIn } from '../support/sign-in';

// Compta contre PostgreSQL réel (tranche 4 de la phase 5) : verrou sur le reste (CPT-03),
// idempotence concurrente (CPT-71), journal égal à la projection (CPT-70), état réel sans
// version (LST-11, VIS-35), revue ouverte par l'avis de changement (CPT-57, CPT-58).

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

const http = () => request(app.getHttpServer());
type Body = Record<string, unknown>;

async function person(): Promise<SignedIn> {
  const { accountId, profileId } = await createAccountWithProfile(prisma);
  return signIn(app, { accountId, profileId });
}

async function link(x: SignedIn, y: SignedIn): Promise<void> {
  const [a, b] = [x.profileId!, y.profileId!].sort();
  await prisma.profileLink.create({
    data: {
      id: randomUUID(),
      profileAId: a!,
      profileBId: b!,
      status: 'ACCEPTED',
      requestedBy: a!,
      aGuardianRequired: false,
      bGuardianRequired: false,
    },
  });
}

async function world() {
  const marie = await person();
  const papa = await person();
  const tonton = await person();
  await link(marie, papa);
  await link(marie, tonton);
  const lists = await http().get('/api/v1/lists').set({ Cookie: marie.cookie }).expect(200);
  const listId = (lists.body.items as Body[]).find((l) => l.personal)!.id as string;
  const product = await http()
    .post('/api/v1/products')
    .set(marie.mutation)
    .send({ title: 'Robot pâtissier', unitPriceMinor: 10_000 })
    .expect(201);
  const item = await http()
    .post(`/api/v1/lists/${listId}/items`)
    .set(marie.mutation)
    .send({ productId: product.body.id })
    .expect(201);
  return { marie, papa, tonton, itemId: item.body.id as string };
}

function contribute(user: SignedIn, itemId: string, body: Body, key = randomUUID()) {
  return http()
    .put(`/api/v1/items/${itemId}/contribution`)
    .set({ ...user.mutation, 'Idempotency-Key': key })
    .send(body);
}

describe('Compta en base (CPT-03, CPT-70, CPT-71)', () => {
  it('CPT-03 : deux requêtes pour le dernier reste, une réussit, l’autre a le reste à jour', async () => {
    const { papa, tonton, itemId } = await world();
    const [a, b] = await Promise.all([
      contribute(papa, itemId, { mode: 'FIXED', amountMinor: 6_000 }),
      contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 6_000 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const refused = a.status === 409 ? a : b;
    expect(refused.body).toMatchObject({
      code: 'CONTRIBUTION_EXCEEDS_REMAINING',
      remainingMinor: 4_000,
    });
    const rows = await prisma.contribution.findMany({ where: { accounting: { itemId } } });
    expect(rows.reduce((sum, r) => sum + Number(r.amountMinor), 0)).toBe(6_000);
  }, 30_000);

  it('CPT-03 : la première participation simultanée n’ouvre qu’une fiche', async () => {
    const { papa, tonton, itemId } = await world();
    const results = await Promise.all([
      contribute(papa, itemId, { mode: 'FIXED', amountMinor: 1_000 }),
      contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 2_000 }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await prisma.itemAccounting.count({ where: { itemId } })).toBe(1);
    const ranks = (await prisma.contribution.findMany({ where: { accounting: { itemId } } }))
      .map((r) => r.rank)
      .sort();
    expect(ranks).toEqual([1, 2]);
  }, 30_000);

  it('CPT-71 : la même clé envoyée deux fois en même temps n’a d’effet qu’une fois', async () => {
    const { papa, itemId } = await world();
    const key = randomUUID();
    const [a, b] = await Promise.all([
      contribute(papa, itemId, { mode: 'FIXED', amountMinor: 2_500 }, key),
      contribute(papa, itemId, { mode: 'FIXED', amountMinor: 2_500 }, key),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.body).toEqual(a.body);
    const accounting = await prisma.itemAccounting.findUniqueOrThrow({ where: { itemId } });
    const operations = await prisma.ledgerEntry.groupBy({
      by: ['operationId'],
      where: { accountingId: accounting.id },
    });
    expect(operations).toHaveLength(1);
    const reused = await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 2_600 }, key);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  }, 30_000);

  it('CPT-70 : rejouer le journal en base redonne les participations', async () => {
    const { papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'PERCENT', shareNum: 1, shareDen: 3 }).expect(200);
    await contribute(tonton, itemId, { mode: 'PERCENT', shareNum: 1, shareDen: 3 }).expect(200);
    await contribute(papa, itemId, { mode: 'FULL' }).expect(200);
    await http()
      .delete(`/api/v1/items/${itemId}/contribution`)
      .set({ ...tonton.mutation, 'Idempotency-Key': randomUUID() })
      .expect(200);
    const accounting = await prisma.itemAccounting.findUniqueOrThrow({
      where: { itemId },
      include: { contributions: true },
    });
    const entries = await prisma.ledgerEntry.findMany({ where: { accountingId: accounting.id } });
    const rebuilt = replay(
      entries.map((e): LedgerRecord => ({
        id: e.id,
        kind: e.kind as LedgerRecord['kind'],
        targetId: e.targetId!,
        before: e.before as LedgerRecord['before'],
        after: e.after as LedgerRecord['after'],
        at: e.at,
      })),
    );
    for (const row of accounting.contributions) {
      expect(rebuilt.get(row.id)).toMatchObject({
        amount: Number(row.amountMinor),
        mode: row.mode,
        rank: row.rank,
      });
    }
    const rebuiltContributions = [...rebuilt.keys()].filter((id) => id !== accounting.id);
    expect(rebuiltContributions.sort()).toEqual(accounting.contributions.map((c) => c.id).sort());
  }, 30_000);

  it('LST-11, VIS-35 : l’état réel suit la compta sans faire bouger la version', async () => {
    const { papa, itemId } = await world();
    const before = await prisma.listItem.findUniqueOrThrow({ where: { id: itemId } });
    await contribute(papa, itemId, { mode: 'FULL' }).expect(200);
    const after = await prisma.listItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(after.status).toBe('RESERVED');
    expect(after.version).toBe(before.version);
  }, 30_000);

  it('CPT-57, CPT-58 : la destinataire change le prix ; la revue est ouverte à son nom', async () => {
    const { marie, papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 5_000 }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 5_000 }).expect(200);
    const item = await prisma.listItem.findUniqueOrThrow({ where: { id: itemId } });
    await http()
      .patch(`/api/v1/items/${itemId}`)
      .set({ ...marie.mutation, 'If-Match': String(item.version) })
      .send({ unitPriceMinor: 11_000 })
      .expect(200);
    await app.get(InProcessAppEvents).drain();
    const reviews = await prisma.accountingReview.findMany({ where: { accounting: { itemId } } });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      kind: 'COST',
      status: 'PENDING',
      authorProfileId: marie.profileId,
    });
  }, 30_000);

  it('CPT-12 à CPT-18, CPT-61 : achat, hausse refusée, décocher et changement d’acheteur en base', async () => {
    const { papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 3_000 }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 7_000 }).expect(200);
    const post = (user: SignedIn, path: string, body?: Body) => {
      const req = http()
        .post(path)
        .set({ ...user.mutation, 'Idempotency-Key': randomUUID() });
      return body ? req.send(body) : req;
    };
    await post(tonton, `/api/v1/items/${itemId}/buyer-requests`).expect(200);
    const request = await prisma.buyerRequest.findFirstOrThrow({
      where: { accounting: { itemId }, status: 'PENDING' },
    });
    await post(papa, `/api/v1/buyer-requests/${request.id}/refuse`).expect(200);
    await http()
      .put(`/api/v1/items/${itemId}/purchase`)
      .set({ ...papa.mutation, 'Idempotency-Key': randomUUID() })
      .send({ actualTotalMinor: 11_000 })
      .expect(200);
    const lowered = await post(tonton, `/api/v1/items/${itemId}/contribution/lower`, {
      amountMinor: 7_200,
    }).expect(200);
    expect(lowered.body.remainingMinor).toBe(800);
    const rows = await prisma.contribution.findMany({
      where: { accounting: { itemId } },
      orderBy: { rank: 'asc' },
    });
    expect(
      rows.map((r) => [Number(r.amountMinor), Number(r.prePurchaseMinor), r.settlement]),
    ).toEqual([
      [3_000, 3_000, 'NONE'],
      [7_200, 7_000, 'DUE'],
    ]);
    expect((await prisma.listItem.findUniqueOrThrow({ where: { id: itemId } })).status).toBe(
      'PURCHASED',
    );
    await http()
      .delete(`/api/v1/items/${itemId}/purchase`)
      .set({ ...papa.mutation, 'Idempotency-Key': randomUUID() })
      .expect(200);
    expect(await prisma.purchase.count({ where: { accounting: { itemId } } })).toBe(0);
    expect((await prisma.listItem.findUniqueOrThrow({ where: { id: itemId } })).status).toBe(
      'RESERVED',
    );
    const kinds = (
      await prisma.ledgerEntry.findMany({
        where: { accounting: { itemId } },
        select: { kind: true },
      })
    ).map((e) => e.kind);
    for (const kind of [
      'BUYER_REQUEST_OPENED',
      'BUYER_REQUEST_DECIDED',
      'PURCHASE_SET',
      'CONTRIBUTION_LOWERED',
      'PURCHASE_REMOVED',
    ]) {
      expect(kinds).toContain(kind);
    }
  }, 30_000);

  it('CPT-68 : la compensation règle les deux sens en une transaction, journal compris', async () => {
    const { papa, tonton, itemId: velo } = await world();
    const leo = await person();
    await link(leo, papa);
    await link(leo, tonton);
    await contribute(papa, velo, { mode: 'FIXED', amountMinor: 3_000 }).expect(200);
    await contribute(tonton, velo, { mode: 'FIXED', amountMinor: 2_000 }).expect(200);
    await http()
      .put(`/api/v1/items/${velo}/purchase`)
      .set({ ...papa.mutation, 'Idempotency-Key': randomUUID() })
      .send({})
      .expect(200);
    const lists = await http().get('/api/v1/lists').set({ Cookie: leo.cookie }).expect(200);
    const listId = (lists.body.items as Body[]).find((l) => l.personal)!.id as string;
    const product = await http()
      .post('/api/v1/products')
      .set(leo.mutation)
      .send({ title: 'Livre', unitPriceMinor: 3_500 })
      .expect(201);
    const livre = (
      await http()
        .post(`/api/v1/lists/${listId}/items`)
        .set(leo.mutation)
        .send({ productId: product.body.id })
        .expect(201)
    ).body.id as string;
    await contribute(tonton, livre, { mode: 'FIXED', amountMinor: 2_000 }).expect(200);
    await contribute(papa, livre, { mode: 'FIXED', amountMinor: 1_500 }).expect(200);
    await http()
      .put(`/api/v1/items/${livre}/purchase`)
      .set({ ...tonton.mutation, 'Idempotency-Key': randomUUID() })
      .send({})
      .expect(200);
    const proposal = await http()
      .post('/api/v1/offset-proposals')
      .set(papa.mutation)
      .send({ counterpartId: tonton.profileId, currency: 'EUR' })
      .expect(200);
    await http()
      .post(`/api/v1/offset-proposals/${proposal.body.id as string}/confirm`)
      .set({ ...tonton.mutation, 'Idempotency-Key': randomUUID() })
      .expect(200);
    const settled = await prisma.contribution.findMany({
      where: { accounting: { itemId: { in: [velo, livre] } }, settledMinor: { gt: 0 } },
      select: { settledMinor: true, profileId: true },
    });
    expect(settled.map((r) => [r.profileId, Number(r.settledMinor)]).sort()).toEqual(
      [
        [papa.profileId, 1_500],
        [tonton.profileId, 1_500],
      ].sort(),
    );
    expect(
      await prisma.ledgerEntry.count({
        where: { kind: 'SETTLEMENT_OFFSET', accounting: { itemId: { in: [velo, livre] } } },
      }),
    ).toBe(2);
    expect(
      (await prisma.offsetProposal.findUniqueOrThrow({ where: { id: proposal.body.id as string } }))
        .status,
    ).toBe('CONFIRMED');
  }, 30_000);

  it('CPT-23, CPT-64 : rappels réclamés une fois ; le reste passe à l’acheteur après l’événement', async () => {
    const { marie, papa, tonton, itemId } = await world();
    const event = await http()
      .post('/api/v1/events')
      .set(marie.mutation)
      .send({ title: 'Anniversaire', date: '2026-12-24', type: 'BIRTHDAY', mode: 'EXCHANGE' })
      .expect(201);
    const item = await prisma.listItem.findUniqueOrThrow({ where: { id: itemId } });
    await prisma.list.update({
      where: { id: item.listId },
      data: { personalProfileId: null, eventId: event.body.id as string },
    });
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 3_000 }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 7_000 }).expect(200);
    await http()
      .put(`/api/v1/items/${itemId}/purchase`)
      .set({ ...papa.mutation, 'Idempotency-Key': randomUUID() })
      .send({ actualTotalMinor: 11_000 })
      .expect(200);
    await http()
      .post(`/api/v1/items/${itemId}/contribution/lower`)
      .set({ ...tonton.mutation, 'Idempotency-Key': randomUUID() })
      .send({ amountMinor: 7_200 })
      .expect(200);
    const accounting = await prisma.itemAccounting.findUniqueOrThrow({ where: { itemId } });
    await prisma.purchase.update({
      where: { accountingId: accounting.id },
      data: { purchasedAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    await prisma.event.update({
      where: { id: event.body.id as string },
      data: { date: new Date(Date.now() - 2 * 86_400_000) },
    });
    const tasks = app.get(RunSettlementTasks);
    const first = await tasks.execute();
    expect(first.reminders).toBeGreaterThanOrEqual(1);
    expect(first.absorbed).toBeGreaterThanOrEqual(1);
    const rows = await prisma.contribution.findMany({
      where: { accountingId: accounting.id },
      orderBy: { rank: 'asc' },
    });
    expect(Number(rows[0]!.amountMinor)).toBe(3_800);
    expect(rows[1]!.remindedSevenAt).not.toBeNull();
    expect(rows[1]!.remindedEventAt).not.toBeNull();
    // Réclamés une seule fois.
    const reminded = rows[1]!.remindedSevenAt;
    await tasks.execute();
    const again = await prisma.contribution.findUniqueOrThrow({ where: { id: rows[1]!.id } });
    expect(again.remindedSevenAt).toEqual(reminded);
    expect(
      await prisma.ledgerEntry.count({
        where: { accountingId: accounting.id, kind: 'SHORTFALL_ABSORBED' },
      }),
    ).toBe(1);
  }, 30_000);

  it('critère de 05 : un retrait engagé alerte les organisateurs, jamais un destinataire (VIS-20)', async () => {
    const { marie, papa, tonton, itemId } = await world();
    const event = await http()
      .post('/api/v1/events')
      .set(papa.mutation)
      .send({ title: 'Fête', date: '2026-12-24', type: 'OTHER', mode: 'EXCHANGE' })
      .expect(201);
    const eventId = event.body.id as string;
    const item = await prisma.listItem.findUniqueOrThrow({ where: { id: itemId } });
    await prisma.list.update({
      where: { id: item.listId },
      data: { personalProfileId: null, eventId },
    });
    // Marie, destinataire de la liste, est aussi organisatrice.
    await prisma.eventParticipant.create({
      data: {
        id: randomUUID(),
        eventId,
        profileId: marie.profileId!,
        role: 'ORGANIZER',
        rsvp: 'YES',
      },
    });
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 1_000 }).expect(200);
    const engagements = app.get(EventEngagements, { strict: false });
    expect(await engagements.withdrawalAlertCandidates(eventId, tonton.profileId!)).toEqual([
      papa.profileId,
    ]);
    expect(await engagements.withdrawalAlertCandidates(eventId, papa.profileId!)).toEqual([]);
  }, 30_000);

  it('I1 (revue SEC-40) : achat et suppression simultanés, la suppression réussit toujours', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { marie, papa, itemId } = await world();
      await contribute(papa, itemId, { mode: 'FULL' }).expect(200);
      const [purchased, deleted] = await Promise.all([
        http()
          .put(`/api/v1/items/${itemId}/purchase`)
          .set({ ...papa.mutation, 'Idempotency-Key': randomUUID() })
          .send({}),
        http().delete(`/api/v1/items/${itemId}`).set(marie.mutation),
      ]);
      expect(deleted.status).toBe(204);
      expect([200, 404]).toContain(purchased.status);
    }
  }, 60_000);

  it('I2 (revue SEC-40) : un participant devenu destinataire n’a rien d’une fiche détachée', async () => {
    const { marie, papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 3_000 }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 2_000 }).expect(200);
    await http()
      .put(`/api/v1/items/${itemId}/purchase`)
      .set({ ...papa.mutation, 'Idempotency-Key': randomUUID() })
      .send({})
      .expect(200);
    const item = await prisma.listItem.findUniqueOrThrow({ where: { id: itemId } });
    // Tonton devient co-destinataire de la liste, puis le souhait est supprimé.
    await prisma.listRecipient.create({
      data: { id: randomUUID(), listId: item.listId, profileId: tonton.profileId! },
    });
    await http().delete(`/api/v1/items/${itemId}`).set(marie.mutation).expect(204);
    const detached = await prisma.itemAccounting.findFirstOrThrow({
      where: {
        detachedTitle: { not: null },
        contributions: { some: { profileId: tonton.profileId } },
      },
    });
    expect(detached.detachedRecipientIds).toContain(tonton.profileId);
    const balances = await http()
      .get('/api/v1/balances')
      .set({ Cookie: tonton.cookie })
      .expect(200);
    expect(balances.body.items).toEqual([]);
    const part = await prisma.contribution.findFirstOrThrow({
      where: { accountingId: detached.id, profileId: tonton.profileId },
    });
    await http()
      .post(`/api/v1/contributions/${part.id}/claim`)
      .set({ ...tonton.mutation, 'Idempotency-Key': randomUUID() })
      .expect(404);
    // Papa, l'acheteur, garde l'accès.
    const forPapa = await http().get('/api/v1/balances').set({ Cookie: papa.cookie }).expect(200);
    expect(forPapa.body.items).not.toEqual([]);
  }, 30_000);
});
