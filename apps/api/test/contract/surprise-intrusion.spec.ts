import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import { session, type SignedIn } from '../support/sign-in';
import {
  createTestApp,
  type TestAdmin,
  type TestCatalog,
  type TestConversations,
  type TestIdentity,
} from './create-test-app';

// SEC-42 : test d'intrusion ciblé sur la surprise, pour les canaux ouverts par la phase 7.
// Léa est destinataire ; Paul participe à un de ses souhaits et en parle au fil des offreurs. Léa
// essaie tout ce qu'une destinataire curieuse peut essayer : signaler le message des offreurs pour
// en apprendre l'existence, chercher la fiche au catalogue, exporter ses données, lire les
// décisions de modération, entrer dans l'espace d'administration. Rien de ce que préparent les
// offreurs ne doit lui parvenir (VIS-20, VIS-22).

const SECRET = `SURPRISE-${randomUUID()}`;
const AMOUNT = 4_321;

let app: INestApplication;
let identity: TestIdentity;
let conversations: TestConversations;
let catalog: TestCatalog;
let admin: TestAdmin;

beforeAll(async () => {
  ({ app, identity, conversations, catalog, admin } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  identity.rateLimiter.reset();
});

const http = () => request(app.getHttpServer());
type Body = Record<string, unknown>;

async function person(role?: 'MODERATOR' | 'ADMIN'): Promise<SignedIn> {
  const user = await identity.signIn(role ? { role } : {});
  identity.accounts.seed({ id: user.accountId, email: `s-${user.accountId}@lahotte.test` });
  // `seed` remet le rôle par défaut.
  if (role) identity.sessions.addAccount(user.accountId, role);
  return user;
}

async function reauthenticated(user: SignedIn): Promise<SignedIn> {
  const rotated = await app.get(SessionLifecycle).rotate({
    id: user.sessionId,
    accountId: user.accountId,
    tokenHash: user.tokenHash,
  });
  return session(
    app,
    rotated.token,
    rotated.record.tokenHash,
    user.sessionId,
    user.accountId,
    rotated.record.activeProfileId,
  );
}

async function link(x: SignedIn, y: SignedIn): Promise<void> {
  const invitation = await http().post('/api/v1/invitations').set(x.mutation).send({}).expect(201);
  await http()
    .post('/api/v1/invitations/redeem')
    .set(y.mutation)
    .send({ token: invitation.body.token as string })
    .expect(201);
}

const shape = (res: request.Response) => {
  const { requestId: _r, instance: _i, ...rest } = res.body as Body;
  return { status: res.status, body: rest };
};

async function world(leaRole?: 'MODERATOR' | 'ADMIN') {
  const lea = await person(leaRole);
  const paul = await person();
  await link(lea, paul);
  const list = await http()
    .post('/api/v1/lists')
    .set(lea.mutation)
    .send({ type: 'WISHLIST', title: 'Noël', recipientIds: [lea.profileId] })
    .expect(201);
  const product = await http()
    .post('/api/v1/products')
    .set(lea.mutation)
    .send({ title: 'Vélo', unitPriceMinor: 10_000, currency: 'EUR' })
    .expect(201);
  const item = await http()
    .post(`/api/v1/lists/${list.body.id as string}/items`)
    .set(lea.mutation)
    .send({ productId: product.body.id as string })
    .expect(201);
  const itemId = item.body.id as string;
  await http()
    .put(`/api/v1/items/${itemId}/contribution`)
    .set({ ...paul.mutation, 'Idempotency-Key': randomUUID() })
    .send({ mode: 'FIXED', amountMinor: AMOUNT })
    .expect(200);
  const comment = await http()
    .post(`/api/v1/items/${itemId}/comments`)
    .set(paul.mutation)
    .send({ thread: 'GIVERS', body: SECRET })
    .expect(201);
  await conversations.settle();
  return {
    lea,
    paul,
    itemId,
    commentId: comment.body.id as string,
    productId: product.body.id as string,
  };
}

describe('Surprise face aux canaux de la phase 7 (SEC-42, VIS-20, VIS-22)', () => {
  it('signaler le message des offreurs répond comme pour un message qui n’existe pas', async () => {
    const { lea, commentId } = await world();
    const real = await http()
      .post('/api/v1/reports')
      .set(lea.mutation)
      .send({ targetKind: 'COMMENT', targetId: commentId, reason: 'SPAM' });
    const fake = await http()
      .post('/api/v1/reports')
      .set(lea.mutation)
      .send({ targetKind: 'COMMENT', targetId: randomUUID(), reason: 'SPAM' });
    expect(shape(real)).toEqual(shape(fake));
    expect(real.status).toBe(404);
  });

  it('l’export de la destinataire ne dit rien de la participation ni du fil des offreurs', async () => {
    const { lea } = await world();
    const fresh = await reauthenticated(lea);
    const created = await http().post('/api/v1/profiles/me/export').set(fresh.mutation).expect(201);
    const res = await http()
      .get(`/api/v1/profiles/me/export/${created.body.id as string}`)
      .set('Cookie', fresh.cookie)
      .expect(200);
    expect(res.text).not.toContain(SECRET);
    expect(res.text).not.toContain(String(AMOUNT));
    const document = JSON.parse(res.text) as Body;
    expect((document.cart as { groups: unknown[] }).groups).toEqual([]);
    expect((document.balances as { items: unknown[] }).items).toEqual([]);
  });

  it('ni le catalogue, ni la recherche, ni la modération, ni l’administration ne laissent rien voir', async () => {
    const { lea, itemId } = await world();
    const reads = [
      '/api/v1/directory',
      '/api/v1/directory/global',
      `/api/v1/directory/global?q=${encodeURIComponent(SECRET)}`,
      '/api/v1/moderation-decisions',
      '/api/v1/notifications',
      `/api/v1/items/${itemId}`,
      `/api/v1/items/${itemId}/threads`,
    ];
    for (const path of reads) {
      const res = await http().get(path).set('Cookie', lea.cookie);
      expect({ path, leaked: JSON.stringify(res.body).includes(SECRET) }).toEqual({
        path,
        leaked: false,
      });
      expect({ path, amount: JSON.stringify(res.body).includes(String(AMOUNT)) }).toEqual({
        path,
        amount: false,
      });
    }
    for (const path of ['/api/v1/admin/moderation/queue', '/api/v1/admin/stats']) {
      await http().get(path).set('Cookie', lea.cookie).expect(404);
    }
    await http()
      .get(`/api/v1/items/${itemId}/comments?thread=GIVERS`)
      .set('Cookie', lea.cookie)
      .expect(404);
  });

  it('un message des offreurs masqué par la modération ne change rien de ce que voit la destinataire', async () => {
    const { lea, itemId, commentId } = await world();
    const before = await http().get(`/api/v1/items/${itemId}/threads`).set('Cookie', lea.cookie);
    for (let i = 0; i < 3; i += 1) {
      const giver = await person();
      // Un tiers qui ne lit pas le fil ne peut pas le faire masquer.
      await http()
        .post('/api/v1/reports')
        .set(giver.mutation)
        .send({ targetKind: 'COMMENT', targetId: commentId, reason: 'SPAM' })
        .expect(404);
    }
    const after = await http().get(`/api/v1/items/${itemId}/threads`).set('Cookie', lea.cookie);
    expect(after.body).toEqual(before.body);
  });

  it('une destinataire modératrice ne voit pas le message des offreurs signalé et ne peut pas en décider (ADM-05, MOD-10)', async () => {
    const { lea, paul, itemId, commentId } = await world('MODERATOR');
    const marc = await person();
    await link(lea, marc);
    await link(paul, marc);
    const threads = await http().get(`/api/v1/items/${itemId}/threads`).set('Cookie', marc.cookie);
    expect(threads.status).toBe(200);
    const decide = (user: SignedIn) =>
      http()
        .post(`/api/v1/admin/moderation/comments/${commentId}/decide`)
        .set(user.mutation)
        .send({ decision: 'REMOVE', reason: 'Contenu vérifié par la modération' });
    // Avant tout signalement : rien à modérer.
    const unreported = await decide(lea);
    await http()
      .post('/api/v1/reports')
      .set(marc.mutation)
      .send({ targetKind: 'COMMENT', targetId: commentId, reason: 'OTHER', note: SECRET })
      .expect(204);
    // Un modérateur sans lien voit l'entrée : elle existe bien.
    const other = await identity.signIn({ role: 'MODERATOR' });
    const seen = await http()
      .get('/api/v1/admin/moderation/queue')
      .set('Cookie', other.cookie)
      .expect(200);
    expect(JSON.stringify(seen.body)).toContain(SECRET);
    const queue = await http()
      .get('/api/v1/admin/moderation/queue')
      .set('Cookie', lea.cookie)
      .expect(200);
    expect(JSON.stringify(queue.body)).not.toContain(SECRET);
    expect(JSON.stringify(queue.body)).not.toContain(commentId);
    // m1 : signalé ou non, la réponse est la même ; elle ne dit pas que le message la concerne.
    const reported = await decide(lea);
    expect(shape(reported)).toEqual(shape(unreported));
    expect(reported.status).toBe(409);
    expect(reported.body.code).toBe('NOTHING_TO_MODERATE');
    // Et le message n'est pas retiré pour autant.
    const kept = await http()
      .get(`/api/v1/items/${itemId}/comments?thread=GIVERS`)
      .set('Cookie', marc.cookie)
      .expect(200);
    expect(JSON.stringify(kept.body)).toContain(SECRET);
  });

  it.each([
    ['', false],
    [', même si l’élément est retiré (M4)', true],
  ])(
    'une fiche préparée pour une destinataire modératrice ne paraît pas dans sa file%s (REP-10, MOD-10)',
    async (_label, withdrawn) => {
      const { lea, paul } = await world('MODERATOR');
      const title = `FICHE-${randomUUID()}`;
      const list = await http()
        .post('/api/v1/lists')
        .set(paul.mutation)
        .send({ type: 'GIFTLIST', title: 'Pour Léa', recipientIds: [lea.profileId] })
        .expect(201);
      const product = await http()
        .post('/api/v1/products')
        .set(paul.mutation)
        .send({ title, unitPriceMinor: 10_000, currency: 'EUR' })
        .expect(201);
      const item = await http()
        .post(`/api/v1/lists/${list.body.id as string}/items`)
        .set(paul.mutation)
        .send({ productId: product.body.id as string })
        .expect(201);
      if (withdrawn) {
        const row = catalog.items.items.get(item.body.id as string);
        if (!row) throw new Error('élément absent');
        catalog.items.items.set(row.id, { ...row, status: 'WITHDRAWN' });
      }
      await http()
        .put(`/api/v1/products/${product.body.id as string}/share`)
        .set(paul.mutation)
        .send({ level: 'GLOBAL' })
        .expect(200);
      const other = await identity.signIn({ role: 'MODERATOR' });
      const seen = await http()
        .get('/api/v1/admin/moderation/queue')
        .set('Cookie', other.cookie)
        .expect(200);
      expect(JSON.stringify(seen.body)).toContain(title);
      const queue = await http()
        .get('/api/v1/admin/moderation/queue')
        .set('Cookie', lea.cookie)
        .expect(200);
      expect(JSON.stringify(queue.body)).not.toContain(title);
    },
  );

  it('une contestation dont le message a disparu reste soustraite à la destinataire modératrice (R1)', async () => {
    const { lea, paul, commentId } = await world('MODERATOR');
    const marc = await person();
    await link(lea, marc);
    await link(paul, marc);
    await http()
      .post('/api/v1/reports')
      .set(marc.mutation)
      .send({ targetKind: 'COMMENT', targetId: commentId, reason: 'SPAM' })
      .expect(204);
    const jean = await identity.signIn({ role: 'MODERATOR' });
    await http()
      .post(`/api/v1/admin/moderation/comments/${commentId}/decide`)
      .set(jean.mutation)
      .send({ decision: 'REMOVE', reason: 'Contenu vérifié par la modération' })
      .expect(204);
    const mine = await http().get('/api/v1/moderation-decisions').set('Cookie', paul.cookie);
    const decisionId = (mine.body.items as { id: string; targetId: string }[]).find(
      (d) => d.targetId === commentId,
    )?.id as string;
    const text = `CONTESTATION-${randomUUID()}`;
    await http()
      .post(`/api/v1/moderation-decisions/${decisionId}/contest`)
      .set(paul.mutation)
      .send({ text })
      .expect(204);
    const before = await http()
      .get('/api/v1/admin/moderation/queue')
      .set('Cookie', jean.cookie)
      .expect(200);
    const contestId = (
      before.body.items as { kind: string; contestId?: string; text?: string }[]
    ).find((e) => e.kind === 'CONTEST' && e.text === text)?.contestId as string;
    expect(contestId).toEqual(expect.any(String));
    await http().delete(`/api/v1/comments/${commentId}`).set(paul.mutation).expect(204);

    const queue = await http()
      .get('/api/v1/admin/moderation/queue')
      .set('Cookie', lea.cookie)
      .expect(200);
    expect(JSON.stringify(queue.body)).not.toContain(text);
    expect(JSON.stringify(queue.body)).not.toContain(contestId);
    const real = await http()
      .post(`/api/v1/admin/moderation/contests/${contestId}/decide`)
      .set(lea.mutation)
      .send({ outcome: 'UPHOLD', reason: 'Contenu vérifié par la modération' });
    const fake = await http()
      .post(`/api/v1/admin/moderation/contests/${randomUUID()}/decide`)
      .set(lea.mutation)
      .send({ outcome: 'UPHOLD', reason: 'Contenu vérifié par la modération' });
    expect(shape(real)).toEqual(shape(fake));
    expect(real.status).toBe(404);
  });

  it('une honorée modératrice ne voit pas le message signalé d’une liste de sa surprise (R2, VIS-36)', async () => {
    const lea = await person('MODERATOR');
    const paul = await person();
    const marc = await person();
    const zoe = await person();
    for (const [x, y] of [
      [marc, lea],
      [marc, paul],
      [marc, zoe],
    ] as const) {
      await link(x, y);
    }
    const event = await http()
      .post('/api/v1/events')
      .set(marc.mutation)
      .send({
        title: 'Fête',
        date: '2027-06-01',
        type: 'BIRTHDAY',
        isSurprise: true,
        honoreeIds: [lea.profileId, paul.profileId],
      })
      .expect(201);
    const eventId = event.body.id as string;
    await http()
      .post(`/api/v1/events/${eventId}/participants`)
      .set(marc.mutation)
      .send({ profileIds: [zoe.profileId] })
      .expect(200);
    await http()
      .put(`/api/v1/events/${eventId}/rsvp`)
      .set(zoe.mutation)
      .send({ rsvp: 'YES' })
      .expect(200);
    const gift = await http()
      .post('/api/v1/lists')
      .set(marc.mutation)
      .send({
        type: 'GIFTLIST',
        title: 'Pour Paul',
        recipientIds: [paul.profileId],
        eventId,
        audience: 'EVENT',
      })
      .expect(201);
    const product = await http()
      .post('/api/v1/products')
      .set(marc.mutation)
      .send({ title: 'Tente' })
      .expect(201);
    const item = await http()
      .post(`/api/v1/lists/${gift.body.id as string}/items`)
      .set(marc.mutation)
      .send({ productId: product.body.id as string })
      .expect(201);
    const body = `FETE-${randomUUID()}`;
    const comment = await http()
      .post(`/api/v1/items/${item.body.id as string}/comments`)
      .set(marc.mutation)
      .send({ thread: 'GIVERS', body })
      .expect(201);
    await conversations.settle();
    await http()
      .post('/api/v1/reports')
      .set(zoe.mutation)
      .send({ targetKind: 'COMMENT', targetId: comment.body.id as string, reason: 'SPAM' })
      .expect(204);
    const other = await identity.signIn({ role: 'MODERATOR' });
    const seen = await http()
      .get('/api/v1/admin/moderation/queue')
      .set('Cookie', other.cookie)
      .expect(200);
    expect(JSON.stringify(seen.body)).toContain(body);
    const queue = await http()
      .get('/api/v1/admin/moderation/queue')
      .set('Cookie', lea.cookie)
      .expect(200);
    expect(JSON.stringify(queue.body)).not.toContain(body);
    await http()
      .post(`/api/v1/admin/moderation/comments/${comment.body.id as string}/decide`)
      .set(lea.mutation)
      .send({ decision: 'REMOVE', reason: 'Contenu vérifié par la modération' })
      .expect(409);
  });

  it('le journal d’audit ne montre pas à une destinataire administratrice la décision sur le fil des offreurs (ADM-05, AUD-06, M1)', async () => {
    const { lea, paul, commentId } = await world('ADMIN');
    const marc = await person();
    await link(lea, marc);
    await link(paul, marc);
    await http()
      .post('/api/v1/reports')
      .set(marc.mutation)
      .send({ targetKind: 'COMMENT', targetId: commentId, reason: 'SPAM' })
      .expect(204);
    const motive = `MOTIF-${randomUUID()}`;
    const jean = await identity.signIn({ role: 'MODERATOR' });
    await http()
      .post(`/api/v1/admin/moderation/comments/${commentId}/decide`)
      .set(jean.mutation)
      .send({ decision: 'REMOVE', reason: motive })
      .expect(204);
    const audit = async (user: SignedIn) =>
      JSON.stringify(
        (
          await http()
            .get(`/api/v1/admin/audit?actorAccountId=${jean.accountId}`)
            .set('Cookie', user.cookie)
            .expect(200)
        ).body,
      );
    // Un administrateur que le message ne concerne pas voit l'entrée et son motif.
    const other = await person('ADMIN');
    expect(await audit(other)).toContain(motive);
    const seen = await audit(lea);
    expect(seen).not.toContain(motive);
    expect(seen).not.toContain(commentId);
    // Revue SEC-40, m1 : une série d'entrées soustraites ne raccourcit pas la page. Six entrées
    // récentes sur ce message, puis une entrée sans cible plus ancienne : la page d'une entrée est
    // pleine pour Léa aussi.
    const older = new Date(Date.now() - 60_000);
    admin.audit.append({
      id: '00000000-0000-7000-8000-000000000001',
      at: older,
      entry: {
        actorAccountId: jean.accountId,
        action: 'audit.read',
        targetKind: null,
        targetId: null,
        reason: null,
        ip: '203.0.113.9',
      },
    });
    for (let i = 0; i < 6; i += 1) {
      admin.audit.append({
        id: randomUUID(),
        at: new Date(),
        entry: {
          actorAccountId: jean.accountId,
          action: 'followup.failed',
          targetKind: 'COMMENT',
          targetId: commentId,
          reason: null,
          ip: '203.0.113.9',
        },
      });
    }
    const page = await http()
      .get(`/api/v1/admin/audit?actorAccountId=${jean.accountId}&limit=1`)
      .set('Cookie', lea.cookie)
      .expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(JSON.stringify(page.body)).not.toContain(commentId);
    // Le message effacé, plus personne ne lit le motif ; et l'entrée ne réapparaît pas pour Léa
    // (revue SEC-40, I2 : faits figés à la décision).
    await http().delete(`/api/v1/comments/${commentId}`).set(paul.mutation).expect(204);
    const after = await audit(other);
    expect(after).toContain(commentId);
    expect(after).not.toContain(motive);
    expect(await audit(lea)).not.toContain(commentId);
  });

  it('un message sur un élément dont la modératrice est écartée (EXCEPT) lui est soustrait (ADM-05, M6)', async () => {
    const lea = await person('MODERATOR');
    const paul = await person();
    const marc = await person();
    await link(paul, lea);
    await link(paul, marc);
    const list = await http()
      .post('/api/v1/lists')
      .set(paul.mutation)
      .send({ type: 'WISHLIST', title: 'Anniversaire', recipientIds: [paul.profileId] })
      .expect(201);
    const product = await http()
      .post('/api/v1/products')
      .set(paul.mutation)
      .send({ title: 'Cadeau pour Léa' })
      .expect(201);
    const item = await http()
      .post(`/api/v1/lists/${list.body.id as string}/items`)
      .set(paul.mutation)
      .send({ productId: product.body.id as string })
      .expect(201);
    const itemId = item.body.id as string;
    await http()
      .put(`/api/v1/items/${itemId}/visibility`)
      .set({ ...paul.mutation, 'If-Match': '1' })
      .send({ mode: 'EXCEPT', profileIds: [lea.profileId] })
      .expect(200);
    const body = `ECARTEE-${randomUUID()}`;
    const comment = await http()
      .post(`/api/v1/items/${itemId}/comments`)
      .set(paul.mutation)
      .send({ thread: 'PUBLIC', body })
      .expect(201);
    const commentId = comment.body.id as string;
    await conversations.settle();
    await http()
      .post('/api/v1/reports')
      .set(marc.mutation)
      .send({ targetKind: 'COMMENT', targetId: commentId, reason: 'SPAM' })
      .expect(204);
    const other = await identity.signIn({ role: 'MODERATOR' });
    const seen = await http()
      .get('/api/v1/admin/moderation/queue')
      .set('Cookie', other.cookie)
      .expect(200);
    expect(JSON.stringify(seen.body)).toContain(body);
    const queue = await http()
      .get('/api/v1/admin/moderation/queue')
      .set('Cookie', lea.cookie)
      .expect(200);
    expect(JSON.stringify(queue.body)).not.toContain(body);
    const res = await http()
      .post(`/api/v1/admin/moderation/comments/${commentId}/decide`)
      .set(lea.mutation)
      .send({ decision: 'REMOVE', reason: 'Contenu vérifié par la modération' })
      .expect(409);
    expect(res.body.code).toBe('NOTHING_TO_MODERATE');
  });

  it('un autre profil du compte de la modératrice est destinataire : le message reste soustrait (ADM-05, M6)', async () => {
    const { lea, paul, commentId } = await world('MODERATOR');
    const marc = await person();
    await link(lea, marc);
    await link(paul, marc);
    await http()
      .post('/api/v1/reports')
      .set(marc.mutation)
      .send({ targetKind: 'COMMENT', targetId: commentId, reason: 'SPAM' })
      .expect(204);
    const second = randomUUID();
    identity.profiles.set({
      profileId: second,
      accountId: lea.accountId,
      hasPin: false,
      relock: 'IDLE_15',
    });
    await http()
      .post('/api/v1/session/profile')
      .set(lea.mutation)
      .send({ profileId: second })
      .expect((res) => {
        expect(res.status).toBeLessThan(300);
      });
    const queue = await http()
      .get('/api/v1/admin/moderation/queue')
      .set('Cookie', lea.cookie)
      .expect(200);
    // `SECRET` est commun aux mondes de ce fichier : seul l'identifiant désigne ce message-ci.
    expect(JSON.stringify(queue.body)).not.toContain(commentId);
    await http()
      .post(`/api/v1/admin/moderation/comments/${commentId}/decide`)
      .set(lea.mutation)
      .send({ decision: 'REMOVE', reason: 'Contenu vérifié par la modération' })
      .expect(409);
  });

  it('un contenu disparu ne garde la file de personne ; on ne signale pas son propre compte (MOD-07, MOD-10, MOD-11)', async () => {
    const { lea, paul, commentId } = await world();
    const marc = await person();
    await link(lea, marc);
    await link(paul, marc);
    await http()
      .post('/api/v1/reports')
      .set(marc.mutation)
      .send({ targetKind: 'COMMENT', targetId: commentId, reason: 'SPAM' })
      .expect(204);
    const jean = await identity.signIn({ role: 'MODERATOR' });
    const queue = async () =>
      JSON.stringify(
        (await http().get('/api/v1/admin/moderation/queue').set('Cookie', jean.cookie).expect(200))
          .body,
      );
    expect(await queue()).toContain(commentId);
    await http().delete(`/api/v1/comments/${commentId}`).set(paul.mutation).expect(204);
    expect(await queue()).not.toContain(commentId);

    // Un autre profil du compte de Paul lit le fil, mais ne signale pas le message de Paul.
    const { lea: lea2, paul: paul2, commentId: other } = await world();
    const second = randomUUID();
    identity.profiles.set({
      profileId: second,
      accountId: paul2.accountId,
      hasPin: false,
      relock: 'IDLE_15',
    });
    await http()
      .post('/api/v1/session/profile')
      .set(paul2.mutation)
      .send({ profileId: second })
      .expect((res) => {
        expect(res.status).toBeLessThan(300);
      });
    await link(lea2, { ...paul2, profileId: second });
    const own = await http()
      .post('/api/v1/reports')
      .set(paul2.mutation)
      .send({ targetKind: 'COMMENT', targetId: other, reason: 'SPAM' })
      .expect(422);
    expect(own.body.code).toBe('REPORT_OWN_CONTENT');
  });
});
