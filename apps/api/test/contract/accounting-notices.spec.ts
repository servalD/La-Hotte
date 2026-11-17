import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RunSettlementTasks } from '../../src/modules/accounting/application/contract';
import type { SignedIn } from '../support/sign-in';
import {
  createTestApp,
  type TestAccounting,
  type TestConversations,
  type TestIdentity,
} from './create-test-app';

// Branchements de la compta (tranche 7 de la phase 5) : notifications par candidat à travers le
// moteur (NOT-05, NOT-10, NOT-12), avis de reste aux seules personnes choisies (CPT-19), rappels
// planifiés (CPT-23), rien pour un destinataire (VIS-20, CPT-52).

let app: INestApplication;
let identity: TestIdentity;
let accounting: TestAccounting;
let conversations: TestConversations;

beforeAll(async () => {
  ({ app, identity, accounting, conversations } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  identity.rateLimiter.reset();
});

const http = () => request(app.getHttpServer());
type Body = Record<string, unknown>;
const key = () => randomUUID();

async function person(): Promise<SignedIn> {
  const user = await identity.signIn();
  identity.accounts.seed({ id: user.accountId, email: `n-${user.accountId}@lahotte.test` });
  return user;
}

async function link(x: SignedIn, y: SignedIn): Promise<void> {
  const invitation = await http().post('/api/v1/invitations').set(x.mutation).send({}).expect(201);
  await http()
    .post('/api/v1/invitations/redeem')
    .set(y.mutation)
    .send({ token: invitation.body.token as string })
    .expect(201);
}

async function world() {
  const marie = await person();
  const papa = await person();
  const tonton = await person();
  const mamie = await person();
  for (const giver of [papa, tonton, mamie]) await link(marie, giver);
  const lists = await http().get('/api/v1/lists').set({ Cookie: marie.cookie }).expect(200);
  const listId = (lists.body.items as Body[]).find((l) => l.personal)!.id as string;
  const product = await http()
    .post('/api/v1/products')
    .set(marie.mutation)
    .send({ title: 'Robot', unitPriceMinor: 10_000 })
    .expect(201);
  const item = await http()
    .post(`/api/v1/lists/${listId}/items`)
    .set(marie.mutation)
    .send({ productId: product.body.id })
    .expect(201);
  return { marie, papa, tonton, mamie, itemId: item.body.id as string };
}

const contribute = (user: SignedIn, itemId: string, body: Body) =>
  http()
    .put(`/api/v1/items/${itemId}/contribution`)
    .set({ ...user.mutation, 'Idempotency-Key': key() })
    .send(body);

async function types(user: SignedIn): Promise<string[]> {
  await conversations.settle();
  const res = await http().get('/api/v1/notifications').set({ Cookie: user.cookie }).expect(200);
  return (res.body.items as Body[]).map((n) => n.type as string);
}

describe('Avis de compta (NOT-12, CPT-19, VIS-20)', () => {
  it('rejoindre et acheter avertissent les autres participants, jamais la destinataire', async () => {
    const { marie, papa, tonton, mamie, itemId } = await world();
    const recipientBefore = await http()
      .get('/api/v1/notifications/unread-count')
      .set({ Cookie: marie.cookie });
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 3_000 }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 6_000 }).expect(200);
    await contribute(mamie, itemId, { mode: 'FIXED', amountMinor: 1_000 }).expect(200);
    expect(await types(papa)).toEqual(expect.arrayContaining(['gift.joined']));
    expect(await types(mamie)).not.toContain('gift.joined');
    await http()
      .put(`/api/v1/items/${itemId}/purchase`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() })
      .send({ actualTotalMinor: 11_000 })
      .expect(200);
    expect(await types(tonton)).toContain('gift.purchased');
    // CPT-19 : Mamie ramène sa part et ne prévient que Papa.
    await http()
      .post(`/api/v1/items/${itemId}/contribution/lower`)
      .set({ ...mamie.mutation, 'Idempotency-Key': key() })
      .send({ amountMinor: 1_200 })
      .expect(200);
    await http()
      .post(`/api/v1/items/${itemId}/shortfall-notice`)
      .set({ ...mamie.mutation, 'Idempotency-Key': key() })
      .send({ profileIds: [papa.profileId] })
      .expect(200);
    expect(await types(papa)).toContain('gift.shortfall');
    expect(await types(tonton)).not.toContain('gift.shortfall');
    // VIS-20 : la destinataire n'a rien reçu, compteur compris.
    expect(await types(marie)).toEqual([]);
    const recipientAfter = await http()
      .get('/api/v1/notifications/unread-count')
      .set({ Cookie: marie.cookie });
    expect(recipientAfter.body).toEqual(recipientBefore.body);
  });

  it('CPT-23 : un rappel échu avertit le participant concerné seulement', async () => {
    const { papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 5_000 }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 5_000 }).expect(200);
    const state = (await accounting.repository.findByItem(itemId))!;
    accounting.repository.dueReminders.push({
      accountingId: state.id,
      itemId,
      participantId: tonton.profileId!,
      participantIds: [papa.profileId!, tonton.profileId!],
      buyerId: papa.profileId!,
    });
    await app.get(RunSettlementTasks).execute();
    expect(await types(tonton)).toContain('gift.settlement_reminder');
    expect(await types(papa)).not.toContain('gift.settlement_reminder');
  });
});

describe('Critère de sortie (VIS-20, CPT-52) : la destinataire ne peut rien observer de la compta', () => {
  it('toutes ses lectures sont identiques avant et après participations, achat, reste et règlements', async () => {
    const { marie, papa, tonton, mamie, itemId } = await world();
    const listId = (
      (await http().get('/api/v1/lists').set({ Cookie: marie.cookie })).body.items as Body[]
    ).find((l) => l.personal)!.id as string;
    const reads = [
      '/api/v1/lists',
      `/api/v1/lists/${listId}`,
      `/api/v1/lists/${listId}/items`,
      `/api/v1/items/${itemId}`,
      `/api/v1/items/${itemId}/threads`,
      `/api/v1/items/${itemId}/accounting`,
      '/api/v1/notifications',
      '/api/v1/notifications/unread-count',
      '/api/v1/directory?scope=circle',
      '/api/v1/cart',
      '/api/v1/balances',
      '/api/v1/accounting/overview',
      '/api/v1/budgets',
    ];
    const snapshot = async () => {
      await conversations.settle();
      const out: unknown[] = [];
      for (const path of reads) {
        const res = await http().get(path).set({ Cookie: marie.cookie });
        const body = { ...(res.body as Body) };
        delete body.requestId;
        out.push([path, res.status, body]);
      }
      return out;
    };
    const before = await snapshot();
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 3_000 }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 6_000 }).expect(200);
    await contribute(mamie, itemId, { mode: 'FIXED', amountMinor: 1_000 }).expect(200);
    await http()
      .put(`/api/v1/items/${itemId}/accounting/options`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() })
      .send({ reviewEnabled: false, receiptEnabled: true })
      .expect(200);
    await http()
      .put(`/api/v1/items/${itemId}/purchase`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() })
      .send({ actualTotalMinor: 11_000 })
      .expect(200);
    await http()
      .post(`/api/v1/items/${itemId}/contribution/lower`)
      .set({ ...mamie.mutation, 'Idempotency-Key': key() })
      .send({ amountMinor: 1_200 })
      .expect(200);
    await http()
      .post(`/api/v1/items/${itemId}/shortfall-notice`)
      .set({ ...mamie.mutation, 'Idempotency-Key': key() })
      .send({ profileIds: [papa.profileId, tonton.profileId] })
      .expect(200);
    const state = (await accounting.repository.findByItem(itemId))!;
    const tontonPart = state.contributions.find((c) => c.profileId === tonton.profileId)!;
    await http()
      .post(`/api/v1/contributions/${tontonPart.id}/claim`)
      .set({ ...tonton.mutation, 'Idempotency-Key': key() })
      .expect(200);
    await http()
      .put(`/api/v1/contributions/${tontonPart.id}/settlement`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() })
      .send({ settled: true })
      .expect(200);
    expect(await snapshot()).toEqual(before);
  });
});
