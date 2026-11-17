import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SignedIn } from '../support/sign-in';
import { createTestApp, type TestAccounting, type TestIdentity } from './create-test-app';

// Règlements, soldes, compensation, budgets, vue latérale (tranche 6 de la phase 5) :
// CPT-20 à CPT-24, CPT-30 à CPT-33, CPT-40 à CPT-45, CPT-65 à CPT-69, VIS-20.

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
  identity.accounts.seed({ id: user.accountId, email: `s-${user.accountId}@lahotte.test` });
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

async function wish(owner: SignedIn, title: string, priceMinor: number): Promise<string> {
  const lists = await http().get('/api/v1/lists').set({ Cookie: owner.cookie }).expect(200);
  const listId = (lists.body.items as Body[]).find((l) => l.personal)!.id as string;
  const product = await http()
    .post('/api/v1/products')
    .set(owner.mutation)
    .send({ title, unitPriceMinor: priceMinor })
    .expect(201);
  const item = await http()
    .post(`/api/v1/lists/${listId}/items`)
    .set(owner.mutation)
    .send({ productId: product.body.id })
    .expect(201);
  return item.body.id as string;
}

const contribute = (user: SignedIn, itemId: string, body: Body) =>
  http()
    .put(`/api/v1/items/${itemId}/contribution`)
    .set({ ...user.mutation, 'Idempotency-Key': key() })
    .send(body);

const purchase = (user: SignedIn, itemId: string) =>
  http()
    .put(`/api/v1/items/${itemId}/purchase`)
    .set({ ...user.mutation, 'Idempotency-Key': key() })
    .send({});

const post = (user: SignedIn, path: string) =>
  http()
    .post(path)
    .set({ ...user.mutation, 'Idempotency-Key': key() });

/** Marie et Léo (destinataires) ; Papa et Tonton se doivent mutuellement. */
async function world() {
  const marie = await person();
  const leo = await person();
  const papa = await person();
  const tonton = await person();
  for (const giver of [papa, tonton]) {
    await link(marie, giver);
    await link(leo, giver);
  }
  // Papa achète le vélo de Marie (Tonton lui doit 20 €) ; Tonton achète le livre de Léo (Papa lui doit 15 €).
  const velo = await wish(marie, 'Vélo', 5_000);
  await contribute(papa, velo, { mode: 'FIXED', amountMinor: 3_000 }).expect(200);
  await contribute(tonton, velo, { mode: 'FIXED', amountMinor: 2_000 }).expect(200);
  await purchase(papa, velo).expect(200);
  const livre = await wish(leo, 'Livre', 3_500);
  await contribute(tonton, livre, { mode: 'FIXED', amountMinor: 2_000 }).expect(200);
  await contribute(papa, livre, { mode: 'FIXED', amountMinor: 1_500 }).expect(200);
  await purchase(tonton, livre).expect(200);
  const id = async (itemId: string, who: SignedIn) =>
    (await accounting.repository.findByItem(itemId))!.contributions.find(
      (c) => c.profileId === who.profileId,
    )!.id;
  return {
    marie,
    leo,
    papa,
    tonton,
    velo,
    livre,
    tontonOnVelo: await id(velo, tonton),
    papaOnLivre: await id(livre, papa),
  };
}

describe('Règlements (CPT-20 à CPT-23, CPT-65)', () => {
  it('le participant signale « j’ai payé », seul l’acheteur règle ; une part n’existe que pour eux', async () => {
    const { marie, papa, tonton, tontonOnVelo } = await world();
    const path = `/api/v1/contributions/${tontonOnVelo}`;
    // CPT-59 : la destinataire et un tiers ne voient pas la part.
    await post(marie, `${path}/claim`).expect(404);
    const claimed = await post(tonton, `${path}/claim`).expect(200);
    expect((claimed.body.mine as Body).settlement).toBe('CLAIMED');
    const byTonton = await http()
      .put(`${path}/settlement`)
      .set({ ...tonton.mutation, 'Idempotency-Key': key() })
      .send({ settled: true });
    expect(byTonton.status).toBe(403);
    await http()
      .put(`${path}/settlement`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() })
      .send({ settled: true, note: 'virement' })
      .expect(200);
    const after = await http()
      .get(
        `/api/v1/items/${(await accounting.repository.findByContribution(tontonOnVelo))!.itemId!}/accounting`,
      )
      .set({ Cookie: tonton.cookie });
    expect(after.body.mine as Body).toMatchObject({ settlement: 'SETTLED', settledMinor: 2_000 });
  });

  it('CPT-23, CPT-66 : une relance par 48 heures', async () => {
    const { papa, tonton, tontonOnVelo } = await world();
    await post(tonton, `/api/v1/contributions/${tontonOnVelo}/nudge`).expect(403);
    await post(papa, `/api/v1/contributions/${tontonOnVelo}/nudge`).expect(200);
    const again = await post(papa, `/api/v1/contributions/${tontonOnVelo}/nudge`);
    expect({ status: again.status, code: again.body.code }).toEqual({
      status: 429,
      code: 'NUDGE_TOO_SOON',
    });
  });
});

describe('Soldes et compensation (CPT-30, CPT-31, CPT-67, CPT-68)', () => {
  it('Papa doit 15 € à Tonton, Tonton lui doit 20 € → Tonton doit 5 € ; compensé, il reste 5 €', async () => {
    const { marie, papa, tonton } = await world();
    const balances = await http()
      .get('/api/v1/balances')
      .set({ Cookie: tonton.cookie })
      .expect(200);
    const withPapa = (balances.body.items as Body[]).find(
      (b) => (b.other as Body).id === papa.profileId,
    )!;
    expect(withPapa).toMatchObject({
      currency: 'EUR',
      iOweMinor: 2_000,
      owesMeMinor: 1_500,
      netMinor: 500,
    });
    // CPT-52 : la destinataire n'a aucun solde.
    const forMarie = await http().get('/api/v1/balances').set({ Cookie: marie.cookie }).expect(200);
    expect(forMarie.body.items).toEqual([]);
    const proposal = await http()
      .post('/api/v1/offset-proposals')
      .set(papa.mutation)
      .send({ counterpartId: tonton.profileId, currency: 'EUR' })
      .expect(200);
    const id = proposal.body.id as string;
    // Seule l'autre partie confirme.
    await post(papa, `/api/v1/offset-proposals/${id}/confirm`).expect(404);
    await post(marie, `/api/v1/offset-proposals/${id}/confirm`).expect(404);
    await post(tonton, `/api/v1/offset-proposals/${id}/confirm`).expect(200);
    const after = await http().get('/api/v1/balances').set({ Cookie: tonton.cookie }).expect(200);
    expect((after.body.items as Body[])[0]).toMatchObject({
      iOweMinor: 500,
      owesMeMinor: 0,
      netMinor: 500,
    });
  });

  it('CPT-68 : une part changée entre proposition et confirmation rend la proposition caduque', async () => {
    const { papa, tonton, tontonOnVelo } = await world();
    const proposal = await http()
      .post('/api/v1/offset-proposals')
      .set(papa.mutation)
      .send({ counterpartId: tonton.profileId, currency: 'EUR' })
      .expect(200);
    await http()
      .put(`/api/v1/contributions/${tontonOnVelo}/settlement`)
      .set({ ...papa.mutation, 'Idempotency-Key': key() })
      .send({ settled: true })
      .expect(200);
    const stale = await post(
      tonton,
      `/api/v1/offset-proposals/${proposal.body.id as string}/confirm`,
    );
    expect({ status: stale.status, code: stale.body.code }).toEqual({
      status: 409,
      code: 'OFFSET_STALE',
    });
  });
});

describe('Budgets et vue latérale (CPT-40 à CPT-45, CPT-69)', () => {
  it('un budget est privé ; la vue latérale groupe hors événement par mois', async () => {
    const { papa, tonton } = await world();
    const mine = await http().get('/api/v1/budgets').set({ Cookie: papa.cookie }).expect(200);
    expect(mine.body.items).toEqual([]);
    // Événement inconnu ou invisible : 404, sans rien écrire.
    await http()
      .put('/api/v1/budgets')
      .set(papa.mutation)
      .send({ eventId: randomUUID(), amountMinor: 30_000, currency: 'EUR' })
      .expect(404);
    const overview = await http()
      .get('/api/v1/accounting/overview')
      .set({ Cookie: papa.cookie })
      .expect(200);
    expect(overview.body.event).toBeNull();
    const lines = (overview.body.groups as Body[]).flatMap((g) => g.lines as Body[]);
    expect(lines.map((l) => [l.title, l.amountMinor, l.isBuyer]).sort()).toEqual([
      ['Livre', 1_500, false],
      ['Vélo', 3_000, true],
    ]);
    expect((overview.body.groups as Body[])[0]!.month).toMatch(/^\d{4}-\d{2}$/);
    expect(overview.body.engaged).toEqual([{ currency: 'EUR', amountMinor: 4_500 }]);
    // CPT-42 : l'acheteur est montré ; aucun montant d'un autre participant (2 000 de Tonton).
    const livre = lines.find((l) => l.title === 'Livre')!;
    expect((livre.buyer as Body).id).toBe(tonton.profileId);
    expect(lines.every((l) => Object.keys(l).every((k) => !/participants|others/.test(k)))).toBe(
      true,
    );
    expect(lines.map((l) => l.amountMinor)).not.toContain(2_000);
  });
});

describe('IDOR des règlements (SEC-03, CPT-59)', () => {
  it('chaque route répond à un étranger et à la destinataire comme à un identifiant inconnu', async () => {
    const { marie, papa, tonton, tontonOnVelo } = await world();
    const proposal = await http()
      .post('/api/v1/offset-proposals')
      .set(papa.mutation)
      .send({ counterpartId: tonton.profileId, currency: 'EUR' })
      .expect(200);
    const event = await http()
      .post('/api/v1/events')
      .set(papa.mutation)
      .send({ title: 'Noël', date: '2026-12-24', type: 'CHRISTMAS', mode: 'EXCHANGE' })
      .expect(201);
    const budget = await http()
      .put('/api/v1/budgets')
      .set(papa.mutation)
      .send({ eventId: event.body.id, amountMinor: 30_000, currency: 'EUR' })
      .expect(200);
    const outsider = await person();
    const table: {
      route: string;
      method: 'put' | 'post' | 'delete';
      path: (id: string) => string;
      body?: Body;
      target: string;
    }[] = [
      {
        route: 'PUT /api/v1/contributions/:id/settlement',
        method: 'put',
        path: (id) => `/api/v1/contributions/${id}/settlement`,
        body: { settled: true },
        target: tontonOnVelo,
      },
      {
        route: 'POST /api/v1/contributions/:id/claim',
        method: 'post',
        path: (id) => `/api/v1/contributions/${id}/claim`,
        target: tontonOnVelo,
      },
      {
        route: 'POST /api/v1/contributions/:id/nudge',
        method: 'post',
        path: (id) => `/api/v1/contributions/${id}/nudge`,
        target: tontonOnVelo,
      },
      {
        route: 'POST /api/v1/offset-proposals/:id/confirm',
        method: 'post',
        path: (id) => `/api/v1/offset-proposals/${id}/confirm`,
        target: proposal.body.id as string,
      },
      {
        route: 'POST /api/v1/offset-proposals/:id/decline',
        method: 'post',
        path: (id) => `/api/v1/offset-proposals/${id}/decline`,
        target: proposal.body.id as string,
      },
      {
        route: 'DELETE /api/v1/budgets/:id',
        method: 'delete',
        path: (id) => `/api/v1/budgets/${id}`,
        target: budget.body.id as string,
      },
    ];
    const snapshot = () =>
      JSON.stringify([
        ...accounting.repository.states.values(),
        ...accounting.repository.offsets.values(),
        ...accounting.budgets.budgets.values(),
      ]);
    for (const intruder of [outsider, marie]) {
      const before = snapshot();
      for (const row of table) {
        const call = (id: string) => {
          const req = http()
            [row.method](row.path(id))
            .set({ ...intruder.mutation, 'Idempotency-Key': key() });
          return row.body ? req.send(row.body) : req;
        };
        const theirs = await call(row.target);
        const unknown = await call(randomUUID());
        expect({ route: row.route, status: theirs.status, code: theirs.body.code }).toEqual({
          route: row.route,
          status: 404,
          code: unknown.body.code,
        });
      }
      expect(snapshot()).toBe(before);
    }
    // CPT-40 : le budget de Papa n'est lu par personne d'autre.
    const others = await http().get('/api/v1/budgets').set({ Cookie: tonton.cookie }).expect(200);
    expect(others.body.items).toEqual([]);
  });
});

describe('M1 (revue SEC-40) : une proposition déclinée ne s’applique plus', () => {
  it('confirmer après un refus rend 404 et ne règle rien', async () => {
    const { papa, tonton } = await world();
    const proposal = await http()
      .post('/api/v1/offset-proposals')
      .set(papa.mutation)
      .send({ counterpartId: tonton.profileId, currency: 'EUR' })
      .expect(200);
    const id = proposal.body.id as string;
    await post(papa, `/api/v1/offset-proposals/${id}/decline`).expect(200);
    const before = JSON.stringify([...accounting.repository.states.values()]);
    await post(tonton, `/api/v1/offset-proposals/${id}/confirm`).expect(404);
    expect(JSON.stringify([...accounting.repository.states.values()])).toBe(before);
  });
});
