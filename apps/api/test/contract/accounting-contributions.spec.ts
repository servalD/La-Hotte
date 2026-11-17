import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { replay } from '../../src/modules/accounting/domain/ledger';
import type { SignedIn } from '../support/sign-in';
import {
  createTestApp,
  type TestAccounting,
  type TestConversations,
  type TestIdentity,
} from './create-test-app';
import { PHASE5_IDOR_ROUTES } from './idor-routes';

// Participations (tranche 4 de la phase 5) : CPT-01 à CPT-07, CPT-53 à CPT-60, CPT-70, CPT-71,
// VIS-20, VIS-35. Ports en mémoire ; le verrou et la base réelle sont vérifiés en intégration.

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

async function person(): Promise<SignedIn> {
  const user = await identity.signIn();
  identity.accounts.seed({ id: user.accountId, email: `c-${user.accountId}@lahotte.test` });
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

/** Marie et son souhait à 100 € ; Papa et Tonton, de son cercle, l'offrent. */
async function world(priceMinor: number | null = 10_000) {
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
    .send({
      title: 'Robot pâtissier',
      ...(priceMinor === null ? {} : { unitPriceMinor: priceMinor }),
    })
    .expect(201);
  const item = await http()
    .post(`/api/v1/lists/${listId}/items`)
    .set(marie.mutation)
    .send({ productId: product.body.id })
    .expect(201);
  return { marie, papa, tonton, itemId: item.body.id as string };
}

const key = () => randomUUID();

function contribute(user: SignedIn, itemId: string, body: Body, idempotencyKey = key()) {
  return http()
    .put(`/api/v1/items/${itemId}/contribution`)
    .set({ ...user.mutation, 'Idempotency-Key': idempotencyKey })
    .send(body);
}

function readAccounting(user: SignedIn, itemId: string) {
  return http().get(`/api/v1/items/${itemId}/accounting`).set({ Cookie: user.cookie });
}

describe('Lire la compta (CPT-59, VIS-20)', () => {
  it('un destinataire reçoit 404 ; un offreur, la vue offreur sans montant individuel', async () => {
    const { marie, papa, tonton, itemId } = await world();
    const unknown = await http()
      .get(`/api/v1/items/${randomUUID()}/accounting`)
      .set({ Cookie: marie.cookie });
    const asRecipient = await readAccounting(marie, itemId);
    expect(asRecipient.status).toBe(404);
    expect(asRecipient.body).toEqual({ ...unknown.body, requestId: asRecipient.body.requestId });
    const empty = await readAccounting(papa, itemId).expect(200);
    expect(empty.body).toMatchObject({
      view: 'giver',
      plannedTotalMinor: 10_000,
      coveredMinor: 0,
      remainingMinor: 10_000,
      participants: [],
      canContribute: true,
    });
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 4_000 }).expect(200);
    const asGiver = await readAccounting(tonton, itemId).expect(200);
    expect(asGiver.body.view).toBe('giver');
    const lines = asGiver.body.participants as Body[];
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toHaveProperty('amountMinor');
    expect(asGiver.body).not.toHaveProperty('mine');
    expect(asGiver.body).not.toHaveProperty('reviews');
    expect(asGiver.body).toMatchObject({ coveredMinor: 4_000, remainingMinor: 6_000 });
  });
});

describe('Participer (CPT-01 à CPT-07, CPT-53 à CPT-56, CPT-60)', () => {
  it('le premier participant devient acheteur ; sa part et le reste sont rendus', async () => {
    const { papa, itemId } = await world();
    const res = await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 4_000 }).expect(200);
    expect(res.body).toMatchObject({
      view: 'participant',
      isBuyer: true,
      coveredMinor: 4_000,
      remainingMinor: 6_000,
      mine: { mode: 'FIXED', amountMinor: 4_000, rank: 1, settlement: 'NONE', settledMinor: 0 },
      reviewEnabled: true,
      receiptEnabled: false,
    });
    expect((res.body.buyer as Body).id).toBe(papa.profileId);
  });

  it('CPT-03 : dépasser le reste rend 409 avec le reste actualisé', async () => {
    const { papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 4_000 }).expect(200);
    const res = await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 7_000 }).expect(409);
    expect(res.body).toMatchObject({
      code: 'CONTRIBUTION_EXCEEDS_REMAINING',
      remainingMinor: 6_000,
    });
  });

  it('CPT-53, CPT-54 : un tiers et une part Tout ; CPT-56 : des exemplaires au prix unitaire', async () => {
    const { papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'PERCENT', shareNum: 1, shareDen: 3 }).expect(200);
    const res = await contribute(tonton, itemId, { mode: 'FULL' }).expect(200);
    const amounts = (res.body.participants as Body[]).map((l) => l.amountMinor);
    expect(amounts).toEqual([3_333, 6_667]);
    expect(res.body.remainingMinor).toBe(0);
    const other = await world();
    const units = await contribute(other.papa, other.itemId, { mode: 'UNITS', units: 1 }).expect(
      200,
    );
    expect((units.body.mine as Body).amountMinor).toBe(10_000);
    await contribute(other.tonton, other.itemId, { mode: 'UNITS', units: 2 }).expect(422);
  });

  it('CPT-55 : sans prix, « Je l’offre » de montant inconnu ; pas de pourcentage', async () => {
    const { papa, tonton, itemId } = await world(null);
    const res = await contribute(papa, itemId, { mode: 'FULL' }).expect(200);
    expect(res.body).toMatchObject({ plannedTotalMinor: null, remainingMinor: null });
    expect((res.body.mine as Body).amountMinor).toBeNull();
    await contribute(tonton, itemId, { mode: 'PERCENT', shareNum: 1, shareDen: 2 }).expect(422);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 1_500 }).expect(200);
  });

  it('CPT-60, VIS-20 : la destinataire ne participe pas (404), validation stricte (400)', async () => {
    const { marie, papa, itemId } = await world();
    const res = await contribute(marie, itemId, { mode: 'FULL' });
    expect({ status: res.status, code: res.body.code }).toEqual({
      status: 404,
      code: 'ACCOUNTING_NOT_FOUND',
    });
    await contribute(papa, itemId, { mode: 'FIXED' }).expect(400);
    await contribute(papa, itemId, { mode: 'PERCENT', shareNum: 1, shareDen: 11 }).expect(400);
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 1, extra: true }).expect(400);
  });

  it('VIS-35 : une participation ne fait bouger ni la version ni l’état vus par la destinataire', async () => {
    const { marie, papa, itemId } = await world();
    const before = await http().get(`/api/v1/items/${itemId}`).set({ Cookie: marie.cookie });
    await contribute(papa, itemId, { mode: 'FULL' }).expect(200);
    const after = await http().get(`/api/v1/items/${itemId}`).set({ Cookie: marie.cookie });
    expect(after.body).toEqual(before.body);
    // LST-11 : l'offreur voit l'état réel.
    const giver = await http().get(`/api/v1/items/${itemId}`).set({ Cookie: papa.cookie });
    expect(giver.body.status).toBe('RESERVED');
  });
});

describe('Retirer (CPT-06, CPT-65)', () => {
  it('retirer rend l’élément ouvert ; l’acheteur passe au suivant', async () => {
    const { papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 3_000 }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 2_000 }).expect(200);
    const res = await http()
      .delete(`/api/v1/items/${itemId}/contribution`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() })
      .expect(200);
    expect(res.body.view).toBe('giver');
    expect((res.body.buyer as Body).id).toBe(tonton.profileId);
    await http()
      .delete(`/api/v1/items/${itemId}/contribution`)
      .set({ ...tonton.mutation, 'Idempotency-Key': key() })
      .expect(200);
    const giver = await http().get(`/api/v1/items/${itemId}`).set({ Cookie: papa.cookie });
    expect(giver.body.status).toBe('OPEN');
    // Sans participation, pas de retrait (404).
    await http()
      .delete(`/api/v1/items/${itemId}/contribution`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() })
      .expect(404);
  });
});

describe('Idempotence (CPT-51, CPT-71)', () => {
  it('sans clé : 422 ; rejouée : même réponse, une seule écriture ; autre requête : 409', async () => {
    const { papa, itemId } = await world();
    const missing = await http()
      .put(`/api/v1/items/${itemId}/contribution`)
      .set(papa.mutation)
      .send({ mode: 'FULL' });
    expect({ status: missing.status, code: missing.body.code }).toEqual({
      status: 422,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
    const k = key();
    const first = await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 2_000 }, k).expect(
      200,
    );
    const entries = accounting.repository.ledger.length;
    const again = await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 2_000 }, k).expect(
      200,
    );
    expect(again.body).toEqual(first.body);
    expect(accounting.repository.ledger.length).toBe(entries);
    const reused = await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 3_000 }, k);
    expect({ status: reused.status, code: reused.body.code }).toEqual({
      status: 409,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  });
});

describe('Prix changé et revue (CPT-57, CPT-58)', () => {
  async function patchPrice(user: SignedIn, itemId: string, unitPriceMinor: number) {
    const current = await http().get(`/api/v1/items/${itemId}`).set({ Cookie: user.cookie });
    const res = await http()
      .patch(`/api/v1/items/${itemId}`)
      .set({ ...user.mutation, 'If-Match': String(current.body.version) })
      .send({ unitPriceMinor });
    // ADR 0019 : la compta relit le coût sur l'avis `item.changed`.
    await conversations.settle();
    return res;
  }

  it('la destinataire change le prix comme sur un souhait libre ; un autre participant valide', async () => {
    const { marie, papa, tonton, itemId } = await world();
    const free = await world();
    await contribute(papa, itemId, { mode: 'PERCENT', shareNum: 3_000, shareDen: 10_000 }).expect(
      200,
    );
    await contribute(tonton, itemId, { mode: 'FULL' }).expect(200);
    const engaged = await patchPrice(marie, itemId, 12_000);
    const unengaged = await patchPrice(free.marie, free.itemId, 12_000);
    expect(engaged.status).toBe(unengaged.status);
    expect(Object.keys(engaged.body as Body).sort()).toEqual(
      Object.keys(unengaged.body as Body).sort(),
    );
    const pending = await readAccounting(papa, itemId).expect(200);
    expect(pending.body).toMatchObject({ plannedTotalMinor: 10_000, itemTotalMinor: 12_000 });
    const reviews = pending.body.reviews as Body[];
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ kind: 'COST', proposedTotalMinor: 12_000, canDecide: true });
    expect((reviews[0]!.author as Body).id).toBe(marie.profileId);
    const approved = await http()
      .post(`/api/v1/accounting-reviews/${reviews[0]!.id as string}/approve`)
      .set({ ...tonton.mutation, 'Idempotency-Key': key() })
      .expect(200);
    expect(approved.body).toMatchObject({
      plannedTotalMinor: 12_000,
      itemTotalMinor: null,
      reviews: [],
    });
    expect((approved.body.participants as Body[]).map((l) => l.amountMinor)).toEqual([
      3_600, 8_400,
    ]);
  });

  it('un seul participant : le nouveau coût s’applique aussitôt', async () => {
    const { marie, papa, itemId } = await world();
    await contribute(papa, itemId, { mode: 'FULL' }).expect(200);
    expect((await patchPrice(marie, itemId, 8_000)).status).toBe(200);
    const res = await readAccounting(papa, itemId).expect(200);
    expect(res.body).toMatchObject({ plannedTotalMinor: 8_000, reviews: [] });
    expect((res.body.mine as Body).amountMinor).toBe(8_000);
  });

  it('refusé, le même coût ne rouvre pas de demande', async () => {
    const { marie, papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 5_000 }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 5_000 }).expect(200);
    expect((await patchPrice(marie, itemId, 9_000)).status).toBe(200);
    const pending = await readAccounting(papa, itemId).expect(200);
    const reviewId = (pending.body.reviews as Body[])[0]!.id as string;
    await http()
      .post(`/api/v1/accounting-reviews/${reviewId}/refuse`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() })
      .expect(200);
    // Une écriture suivante relit le coût : la demande refusée ne revient pas.
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 4_000 }).expect(200);
    const after = await readAccounting(papa, itemId).expect(200);
    expect(after.body).toMatchObject({
      plannedTotalMinor: 10_000,
      itemTotalMinor: 9_000,
      reviews: [],
    });
  });

  it('options : soumises à un autre participant, jamais à leur auteur', async () => {
    const { papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 5_000 }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 5_000 }).expect(200);
    const asked = await http()
      .put(`/api/v1/items/${itemId}/accounting/options`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() })
      .send({ reviewEnabled: true, receiptEnabled: true })
      .expect(200);
    expect(asked.body.receiptEnabled).toBe(false);
    const review = (asked.body.reviews as Body[])[0]!;
    expect(review).toMatchObject({
      kind: 'OPTIONS',
      canDecide: false,
      proposedReceiptEnabled: true,
    });
    const own = await http()
      .post(`/api/v1/accounting-reviews/${review.id as string}/approve`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() });
    expect({ status: own.status, code: own.body.code }).toEqual({
      status: 403,
      code: 'ACCOUNTING_ACTION_FORBIDDEN',
    });
    const ok = await http()
      .post(`/api/v1/accounting-reviews/${review.id as string}/approve`)
      .set({ ...tonton.mutation, 'Idempotency-Key': key() })
      .expect(200);
    expect(ok.body.receiptEnabled).toBe(true);
  });
});

describe('Journal (CPT-50, CPT-70)', () => {
  it('rejouer le journal d’une fiche redonne ses participations', async () => {
    const { papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'PERCENT', shareNum: 1, shareDen: 3 }).expect(200);
    await contribute(tonton, itemId, { mode: 'PERCENT', shareNum: 1, shareDen: 3 }).expect(200);
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 2_000 }).expect(200);
    const state = await accounting.repository.findByItem(itemId);
    const entries = accounting.repository.ledger
      .filter((e) => e.accountingId === state!.id)
      .map((e) => ({ ...e, id: e.id }));
    const rebuilt = replay(entries);
    for (const row of state!.contributions) {
      expect(rebuilt.get(row.id)).toMatchObject({
        amount: row.amount,
        mode: row.mode,
        rank: row.rank,
      });
    }
    expect([...rebuilt.keys()].filter((k) => k !== state!.id).sort()).toEqual(
      state!.contributions.map((c) => c.id).sort(),
    );
  });
});

describe('IDOR de la compta (SEC-03, VIS-34)', () => {
  it('chaque route à identifiant répond à un étranger comme à un identifiant inconnu ; rien ne change', async () => {
    const { marie, papa, tonton, itemId } = await world();
    await contribute(papa, itemId, { mode: 'FIXED', amountMinor: 5_000 }).expect(200);
    await contribute(tonton, itemId, { mode: 'FIXED', amountMinor: 5_000 }).expect(200);
    await http()
      .put(`/api/v1/items/${itemId}/accounting/options`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() })
      .send({ reviewEnabled: true, receiptEnabled: true })
      .expect(200);
    await http()
      .post(`/api/v1/items/${itemId}/buyer-requests`)
      .set({ ...tonton.mutation, 'Idempotency-Key': key() })
      .expect(200);
    const state = await accounting.repository.findByItem(itemId);
    const reviewId = state!.reviews[0]!.id;
    const requestId = state!.buyerRequest!.id;
    const outsider = await person();
    type Row = {
      route: string;
      method: 'get' | 'put' | 'delete' | 'post';
      path: (id: string) => string;
      body?: Body;
      photo?: boolean;
      idOf: 'item' | 'review' | 'request';
    };
    const item = (
      route: string,
      method: Row['method'],
      suffix: string,
      extra: Partial<Row> = {},
    ): Row => ({
      route,
      method,
      path: (id) => `/api/v1/items/${id}${suffix}`,
      idOf: 'item',
      ...extra,
    });
    const table: Row[] = [
      item('GET /api/v1/items/:id/accounting', 'get', '/accounting'),
      item('PUT /api/v1/items/:id/contribution', 'put', '/contribution', {
        body: { mode: 'FULL' },
      }),
      item('DELETE /api/v1/items/:id/contribution', 'delete', '/contribution'),
      item('PUT /api/v1/items/:id/accounting/options', 'put', '/accounting/options', {
        body: { reviewEnabled: false, receiptEnabled: false },
      }),
      item('PUT /api/v1/items/:id/purchase', 'put', '/purchase', { body: {} }),
      item('DELETE /api/v1/items/:id/purchase', 'delete', '/purchase'),
      item('POST /api/v1/items/:id/contribution/lower', 'post', '/contribution/lower', {
        body: { amountMinor: 1 },
      }),
      item('POST /api/v1/items/:id/shortfall-notice', 'post', '/shortfall-notice', {
        body: { profileIds: [] },
      }),
      item('POST /api/v1/items/:id/buyer-requests', 'post', '/buyer-requests'),
      item('PUT /api/v1/items/:id/purchase/receipt', 'put', '/purchase/receipt', { photo: true }),
      item('GET /api/v1/items/:id/purchase/receipt', 'get', '/purchase/receipt'),
      {
        route: 'POST /api/v1/accounting-reviews/:id/approve',
        method: 'post',
        path: (id) => `/api/v1/accounting-reviews/${id}/approve`,
        idOf: 'review',
      },
      {
        route: 'POST /api/v1/accounting-reviews/:id/refuse',
        method: 'post',
        path: (id) => `/api/v1/accounting-reviews/${id}/refuse`,
        idOf: 'review',
      },
      {
        route: 'POST /api/v1/buyer-requests/:id/accept',
        method: 'post',
        path: (id) => `/api/v1/buyer-requests/${id}/accept`,
        idOf: 'request',
      },
      {
        route: 'POST /api/v1/buyer-requests/:id/refuse',
        method: 'post',
        path: (id) => `/api/v1/buyer-requests/${id}/refuse`,
        idOf: 'request',
      },
      {
        route: 'DELETE /api/v1/buyer-requests/:id',
        method: 'delete',
        path: (id) => `/api/v1/buyer-requests/${id}`,
        idOf: 'request',
      },
    ];
    // La destinataire elle-même ne doit rien obtenir non plus (VIS-20).
    for (const intruder of [outsider, marie]) {
      const before = JSON.stringify([...accounting.repository.states.values()]);
      for (const row of table) {
        const call = (id: string) => {
          const req = http()
            [row.method](row.path(id))
            .set({ ...intruder.mutation, 'Idempotency-Key': key() });
          if (row.photo) return req.attach('photo', Buffer.from('\xff\xd8\xff x'), 'x.jpg');
          return row.body ? req.send(row.body) : req;
        };
        const target = row.idOf === 'item' ? itemId : row.idOf === 'review' ? reviewId : requestId;
        const theirs = await call(target);
        const unknown = await call(randomUUID());
        expect({ route: row.route, status: theirs.status, code: theirs.body.code }).toEqual({
          route: row.route,
          status: 404,
          code: unknown.body.code,
        });
      }
      expect(JSON.stringify([...accounting.repository.states.values()])).toBe(before);
      expect(PHASE5_IDOR_ROUTES.filter((route) => !table.some((r) => r.route === route))).toEqual(
        [],
      );
    }
  });
});
