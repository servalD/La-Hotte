import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SignedIn } from '../support/sign-in';
import { createTestApp, type TestAccounting, type TestIdentity } from './create-test-app';

// Acheteur et achat (tranche 5 de la phase 5) : CPT-10 à CPT-19, CPT-55, CPT-61 à CPT-63, VIS-20.

let app: INestApplication;
let identity: TestIdentity;
let accounting: TestAccounting;

beforeAll(async () => {
  ({ app, identity, accounting } = await createTestApp());
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
  identity.accounts.seed({ id: user.accountId, email: `p-${user.accountId}@lahotte.test` });
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

/** Marie et son souhait ; Papa, Tonton et Mamie, de son cercle, l'offrent. */
async function world(priceMinor: number | null = 10_000) {
  const marie = await person();
  const papa = await person();
  const tonton = await person();
  const mamie = await person();
  for (const other of [papa, tonton, mamie]) await link(marie, other);
  const lists = await http().get('/api/v1/lists').set({ Cookie: marie.cookie }).expect(200);
  const listId = (lists.body.items as Body[]).find((l) => l.personal)!.id as string;
  const product = await http()
    .post('/api/v1/products')
    .set(marie.mutation)
    .send({ title: 'Vélo', ...(priceMinor === null ? {} : { unitPriceMinor: priceMinor }) })
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

const purchase = (user: SignedIn, itemId: string, body: Body = {}) =>
  http()
    .put(`/api/v1/items/${itemId}/purchase`)
    .set({ ...user.mutation, 'Idempotency-Key': key() })
    .send(body);

const post = (user: SignedIn, path: string, body?: Body) => {
  const req = http()
    .post(path)
    .set({ ...user.mutation, 'Idempotency-Key': key() });
  return body ? req.send(body) : req;
};

const amounts = (body: Body) => (body.participants as Body[]).map((l) => l.amountMinor);

describe('Achat (CPT-12, CPT-13, CPT-16, CPT-20)', () => {
  it('CPT-16 : 100 € prévus, 110 € payés ; A 60 %, B fixe 40 € → 70 € et 40 €, B à régler', async () => {
    const { marie, papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'PERCENT', shareNum: 6_000, shareDen: 10_000 }).expect(
      200,
    );
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 4_000 }).expect(200);
    const before = await http().get(`/api/v1/items/${itemId}`).set({ Cookie: marie.cookie });
    const res = await purchase(papa, itemId, { actualTotalMinor: 11_000 }).expect(200);
    expect(res.body).toMatchObject({ purchased: true, remainingMinor: 0 });
    expect(amounts(res.body as Body)).toEqual([7_000, 4_000]);
    expect((res.body.mine as Body).settlement).toBe('NONE');
    const asTonton = await http()
      .get(`/api/v1/items/${itemId}/accounting`)
      .set({ Cookie: tonton.cookie });
    expect((asTonton.body.mine as Body).settlement).toBe('DUE');
    // CPT-13 : participations figées ; seul l'acheteur coche (403 à un participant).
    const frozen = await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 3_000 });
    expect(frozen.body.code).toBe('CONTRIBUTION_FROZEN');
    const notBuyer = await purchase(tonton, itemId);
    expect({ status: notBuyer.status, code: notBuyer.body.code }).toEqual({
      status: 403,
      code: 'ACCOUNTING_ACTION_FORBIDDEN',
    });
    // LST-12, LST-16 : l'offreur voit ACHETÉ ; la destinataire ne voit aucun changement.
    const giver = await http().get(`/api/v1/items/${itemId}`).set({ Cookie: papa.cookie });
    expect(giver.body.status).toBe('PURCHASED');
    const after = await http().get(`/api/v1/items/${itemId}`).set({ Cookie: marie.cookie });
    expect(after.body).toEqual(before.body);
  });

  it('CPT-55 : sans prix, le prix payé est obligatoire et fixe la part Tout', async () => {
    const { papa, tonton, itemId } = await world(null);
    await contribute(papa, itemId, { mode: 'FULL' }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 2_000 }).expect(200);
    await purchase(papa, itemId).expect(422);
    const res = await purchase(papa, itemId, { actualTotalMinor: 5_000 }).expect(200);
    expect(amounts(res.body as Body)).toEqual([3_000, 2_000]);
  });
});

describe('Hausse refusée et reste à couvrir (CPT-17 à CPT-19)', () => {
  it('B passe à 80 €, ramène à 72 € ; il reste 8 € ; seuls les cochés sont retenus', async () => {
    const { marie, papa, tonton, mamie, itemId } = await world();
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 3_000 }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 6_000 }).expect(200);
    await contribute(mamie, itemId, { mode: 'FIXED', amountMinor: 1_000 }).expect(200);
    const res = await purchase(papa, itemId, { actualTotalMinor: 11_000 }).expect(200);
    expect(amounts(res.body as Body)).toEqual([3_000, 6_000, 2_000]);
    await post(mamie, `/api/v1/items/${itemId}/contribution/lower`, { amountMinor: 999 }).expect(
      422,
    );
    const lowered = await post(mamie, `/api/v1/items/${itemId}/contribution/lower`, {
      amountMinor: 1_200,
    }).expect(200);
    expect(lowered.body.remainingMinor).toBe(800);
    // CPT-19 : la destinataire ne peut être prévenue ; un choix hors des participants est refusé.
    await post(mamie, `/api/v1/items/${itemId}/shortfall-notice`, {
      profileIds: [marie.profileId],
    }).expect(422);
    await post(mamie, `/api/v1/items/${itemId}/shortfall-notice`, {
      profileIds: [papa.profileId],
    }).expect(200);
    const notice = accounting.repository.notices.at(-1)!;
    expect(notice).toMatchObject({
      authorId: mamie.profileId,
      amount: 800,
      notifiedIds: [papa.profileId],
    });
  });
});

describe('Décocher (CPT-14, CPT-63)', () => {
  it('libre pendant 24 heures, puis avec confirmation ; les parts reviennent', async () => {
    const { papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 3_000 }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 7_000 }).expect(200);
    await purchase(papa, itemId, { actualTotalMinor: 11_000 }).expect(200);
    const free = await http()
      .delete(`/api/v1/items/${itemId}/purchase`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() })
      .expect(200);
    expect(free.body.purchased).toBe(false);
    expect(amounts(free.body as Body)).toEqual([3_000, 7_000]);
    await purchase(papa, itemId).expect(200);
    const state = await accounting.repository.findByItem(itemId);
    accounting.repository.states.set(state!.id, {
      ...state!,
      purchase: { ...state!.purchase!, purchasedAt: new Date(Date.now() - 2 * 86_400_000) },
    });
    const late = await http()
      .delete(`/api/v1/items/${itemId}/purchase`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() });
    expect(late.body.code).toBe('PURCHASE_UNCHECK_CONFIRM');
    await http()
      .delete(`/api/v1/items/${itemId}/purchase?confirm=true`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() })
      .expect(200);
  });
});

describe('Changement d’acheteur (CPT-10, CPT-61)', () => {
  it('l’acheteur accepte ; la destinataire ne voit rien ; le candidat peut retirer sa demande', async () => {
    const { marie, papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 3_000 }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 3_000 }).expect(200);
    await post(tonton, `/api/v1/items/${itemId}/buyer-requests`).expect(200);
    const state = await accounting.repository.findByItem(itemId);
    const requestId = state!.buyerRequest!.id;
    await post(marie, `/api/v1/buyer-requests/${requestId}/accept`).expect(404);
    const own = await post(tonton, `/api/v1/buyer-requests/${requestId}/accept`);
    expect(own.status).toBe(403);
    const res = await post(papa, `/api/v1/buyer-requests/${requestId}/accept`).expect(200);
    expect(res.body.isBuyer).toBe(false);
    expect((res.body.buyer as Body).id).toBe(tonton.profileId);
    await post(papa, `/api/v1/items/${itemId}/buyer-requests`).expect(200);
    const next = (await accounting.repository.findByItem(itemId))!.buyerRequest!.id;
    await http()
      .delete(`/api/v1/buyer-requests/${next}`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() })
      .expect(200);
    expect((await accounting.repository.findByItem(itemId))!.buyerRequest).toBeNull();
  });

  it('après 48 heures sans réponse, hors événement, un autre participant décide', async () => {
    const { papa, tonton, mamie, itemId } = await world();
    for (const user of [papa, tonton, mamie]) {
      await contribute(user, itemId, { mode: 'FIXED', amountMinor: 1_000 }).expect(200);
    }
    await post(tonton, `/api/v1/items/${itemId}/buyer-requests`).expect(200);
    const state = (await accounting.repository.findByItem(itemId))!;
    await post(mamie, `/api/v1/buyer-requests/${state.buyerRequest!.id}/accept`).expect(403);
    accounting.repository.states.set(state.id, {
      ...state,
      buyerRequest: { ...state.buyerRequest!, createdAt: new Date(Date.now() - 49 * 3_600_000) },
    });
    const res = await post(mamie, `/api/v1/buyer-requests/${state.buyerRequest!.id}/accept`).expect(
      200,
    );
    expect((res.body.buyer as Body).id).toBe(tonton.profileId);
  });
});

describe('Justificatif (CPT-15, CPT-58, CPT-62)', () => {
  it('refusé tant que l’option est décochée ; servi aux seuls participants', async () => {
    const { marie, papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'FULL' }).expect(200);
    await purchase(papa, itemId).expect(200);
    const upload = () =>
      http()
        .put(`/api/v1/items/${itemId}/purchase/receipt`)
        .set({ ...papa.mutation, 'Idempotency-Key': key() })
        .attach('photo', Buffer.from('\xff\xd8\xff photo'), 'ticket.jpg');
    expect((await upload()).body.code).toBe('RECEIPT_DISABLED');
    await http()
      .put(`/api/v1/items/${itemId}/accounting/options`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() })
      .send({ reviewEnabled: true, receiptEnabled: true })
      .expect(200);
    await upload().expect(200);
    await http()
      .get(`/api/v1/items/${itemId}/purchase/receipt`)
      .set({ Cookie: papa.cookie })
      .expect(200);
    await http()
      .get(`/api/v1/items/${itemId}/purchase/receipt`)
      .set({ Cookie: tonton.cookie })
      .expect(404);
    await http()
      .get(`/api/v1/items/${itemId}/purchase/receipt`)
      .set({ Cookie: marie.cookie })
      .expect(404);
  });
});

describe('Panier (CPT-11)', () => {
  it('l’acheteur voit ses éléments par destinataire ; un autre profil ne voit pas les siens', async () => {
    const { marie, papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 8_000 }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 1_000 }).expect(200);
    const cart = await http().get('/api/v1/cart').set({ Cookie: papa.cookie }).expect(200);
    const groups = cart.body.groups as Body[];
    expect(groups).toHaveLength(1);
    expect((groups[0]!.recipients as Body[])[0]!.id).toBe(marie.profileId);
    expect((groups[0]!.items as Body[])[0]).toMatchObject({
      itemId,
      title: 'Vélo',
      totalMinor: 10_000,
      coveredMinor: 9_000,
      remainingMinor: 1_000,
      myShareMinor: 8_000,
      purchased: false,
    });
    const other = await http().get('/api/v1/cart').set({ Cookie: tonton.cookie }).expect(200);
    expect(other.body.groups).toEqual([]);
    const recipient = await http().get('/api/v1/cart').set({ Cookie: marie.cookie }).expect(200);
    expect(recipient.body.groups).toEqual([]);
  });
});

describe('Revue SEC-40 de la phase 5, cycle 1', () => {
  it('I3 : cocher Acheté une seconde fois est refusé ; le refus de hausse reste', async () => {
    const { papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 3_000 }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 7_000 }).expect(200);
    await purchase(papa, itemId, { actualTotalMinor: 11_000 }).expect(200);
    await post(tonton, `/api/v1/items/${itemId}/contribution/lower`, { amountMinor: 7_200 }).expect(
      200,
    );
    const again = await purchase(papa, itemId, { actualTotalMinor: 11_000 });
    expect({ status: again.status, code: again.body.code }).toEqual({
      status: 409,
      code: 'PURCHASE_DONE',
    });
    const state = await accounting.repository.findByItem(itemId);
    expect(state!.contributions.find((c) => c.profileId === tonton.profileId)!.amount).toBe(7_200);
  });

  it('I4 : pas de changement d’acheteur, ni de retrait de l’acheteur, avec une part avancée', async () => {
    const { papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 3_000 }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 4_000 }).expect(200);
    const tontonPart = (await accounting.repository.findByItem(itemId))!.contributions.find(
      (c) => c.profileId === tonton.profileId,
    )!;
    // CPT-21 : Tonton avance sa part à Papa.
    await http()
      .put(`/api/v1/contributions/${tontonPart.id}/settlement`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() })
      .send({ settled: true })
      .expect(200);
    await post(tonton, `/api/v1/items/${itemId}/buyer-requests`).expect(200);
    const requestId = (await accounting.repository.findByItem(itemId))!.buyerRequest!.id;
    const accepted = await post(papa, `/api/v1/buyer-requests/${requestId}/accept`);
    expect(accepted.body.code).toBe('CONTRIBUTION_SETTLED');
    const left = await http()
      .delete(`/api/v1/items/${itemId}/contribution`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() });
    expect(left.body.code).toBe('CONTRIBUTION_SETTLED');
  });
});
