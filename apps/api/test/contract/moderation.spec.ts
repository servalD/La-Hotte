import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SignedIn } from '../support/sign-in';
import {
  createTestApp,
  type TestAdmin,
  type TestCatalog,
  type TestConversations,
  type TestIdentity,
} from './create-test-app';

// Signalements et modération : ADM-05, MOD-07 à MOD-11, COM-10, VIS-20.

let app: INestApplication;
let identity: TestIdentity;
let catalog: TestCatalog;
let conversations: TestConversations;
let admin: TestAdmin;

beforeAll(async () => {
  ({ app, identity, catalog, conversations, admin } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  identity.rateLimiter.reset();
});

const http = () => request(app.getHttpServer());
type Body = Record<string, unknown>;
const REASON = 'Contenu vérifié par la modération';

async function person(): Promise<SignedIn> {
  const user = await identity.signIn();
  identity.accounts.seed({ id: user.accountId, email: `m-${user.accountId}@lahotte.test` });
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

const moderator = () => identity.signIn({ role: 'MODERATOR' });

function report(user: SignedIn, body: Body) {
  return http()
    .post('/api/v1/reports')
    .set(user.mutation)
    .send({ reason: 'SPAM', ...body });
}

async function queue(user: SignedIn): Promise<Body[]> {
  const res = await http()
    .get('/api/v1/admin/moderation/queue')
    .set('Cookie', user.cookie)
    .expect(200);
  return res.body.items as Body[];
}

/** Fiche publiée et approuvée au catalogue global (MOD-06). */
async function globalProduct(owner: SignedIn): Promise<string> {
  const res = await http()
    .post('/api/v1/products')
    .set(owner.mutation)
    .send({ title: 'Montre' })
    .expect(201);
  const id = res.body.id as string;
  const row = catalog.products.rows.get(id);
  if (!row) throw new Error('fiche absente');
  const url = `https://boutique.example/${id}`;
  catalog.products.rows.set(id, {
    ...row,
    source: 'LINK',
    extractionStatus: 'DONE',
    sourceUrl: url,
    normalizedUrl: url,
  });
  await http()
    .put(`/api/v1/products/${id}/share`)
    .set(owner.mutation)
    .send({ level: 'GLOBAL' })
    .expect(200);
  return id;
}

/** Wishlist de Léa ; Paul écrit au fil des offreurs ; Max, Zoé, Ana le lisent. */
async function giversWorld() {
  const lea = await person();
  const paul = await person();
  const readers = [await person(), await person(), await person()];
  for (const other of [paul, ...readers]) await link(lea, other);
  const list = await http()
    .post('/api/v1/lists')
    .set(lea.mutation)
    .send({ type: 'WISHLIST', title: 'Noël', recipientIds: [lea.profileId] })
    .expect(201);
  const product = await http()
    .post('/api/v1/products')
    .set(lea.mutation)
    .send({ title: 'Vélo' })
    .expect(201);
  const item = await http()
    .post(`/api/v1/lists/${list.body.id as string}/items`)
    .set(lea.mutation)
    .send({ productId: product.body.id as string })
    .expect(201);
  const itemId = item.body.id as string;
  const comment = await http()
    .post(`/api/v1/items/${itemId}/comments`)
    .set(paul.mutation)
    .send({ thread: 'GIVERS', body: 'Je prends le rouge, qui partage ?' })
    .expect(201);
  return { lea, paul, readers, itemId, commentId: comment.body.id as string };
}

async function giversThread(user: SignedIn, itemId: string): Promise<Body[]> {
  const res = await http()
    .get(`/api/v1/items/${itemId}/comments?thread=GIVERS`)
    .set('Cookie', user.cookie)
    .expect(200);
  return res.body.items as Body[];
}

describe('Signaler (MOD-07, COM-10)', () => {
  it('une cible illisible répond comme une inconnue, et on ne signale pas son contenu', async () => {
    const { lea, paul, readers, commentId } = await giversWorld();
    // VIS-20 : la destinataire ne lit pas le fil des offreurs, elle ne peut donc pas le signaler.
    const hidden = await report(lea, { targetKind: 'COMMENT', targetId: commentId }).expect(404);
    expect(hidden.body.code).toBe('REPORT_TARGET_NOT_FOUND');
    const own = await report(paul, { targetKind: 'COMMENT', targetId: commentId }).expect(422);
    expect(own.body.code).toBe('REPORT_OWN_CONTENT');
    const [max] = readers;
    if (!max) throw new Error('lecteur absent');
    await report(max, { targetKind: 'COMMENT', targetId: commentId }).expect(204);
    // Une seconde fois : rien de plus, même réponse.
    await report(max, { targetKind: 'COMMENT', targetId: commentId }).expect(204);
    expect(admin.moderation.reports.filter((r) => r.target.id === commentId)).toHaveLength(1);
  });

  it('une fiche privée ou inconnue répond 404', async () => {
    const papa = await person();
    const stranger = await person();
    const res = await http().post('/api/v1/products').set(papa.mutation).send({ title: 'Pull' });
    await report(stranger, { targetKind: 'PRODUCT', targetId: res.body.id as string }).expect(404);
    await report(stranger, {
      targetKind: 'PRODUCT',
      targetId: '01890000-0000-7000-8000-000000000000',
    }).expect(404);
  });

  it('valide le motif et la note (SEC-10)', async () => {
    const papa = await person();
    const stranger = await person();
    const id = await globalProduct(papa);
    await report(stranger, { targetKind: 'PRODUCT', targetId: id, reason: 'AUTRE' }).expect(400);
    await report(stranger, {
      targetKind: 'PRODUCT',
      targetId: id,
      note: 'x'.repeat(501),
    }).expect(400);
  });
});

describe('Masquage à trois comptes (MOD-08)', () => {
  it('une fiche sort du catalogue ; « garder » l’y remet', async () => {
    const papa = await person();
    const id = await globalProduct(papa);
    for (let i = 0; i < 3; i += 1) {
      await report(await person(), {
        targetKind: 'PRODUCT',
        targetId: id,
        note: `note ${i}`,
      }).expect(204);
    }
    expect(catalog.products.rows.get(id)?.moderationStatus).toBe('PENDING');
    const mod = await moderator();
    const entry = (await queue(mod)).find(
      (e) => e.kind === 'PRODUCT' && (e.product as Body).id === id,
    );
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain(papa.profileId);
    expect((entry?.reports as Body).reasons).toEqual([{ reason: 'SPAM', count: 3 }]);
    await http()
      .post(`/api/v1/admin/moderation/products/${id}/decide`)
      .set(mod.mutation)
      .send({ decision: 'KEEP', reason: REASON })
      .expect(204);
    expect(catalog.products.rows.get(id)?.moderationStatus).toBe('APPROVED');
    expect(admin.audit.rows.at(-1)).toMatchObject({
      action: 'moderation.decide',
      actorAccountId: mod.accountId,
      targetKind: 'PRODUCT',
      targetId: id,
      after: 'KEEP',
    });
  });

  it('un message masqué ne se lit plus qu’en clair par son auteur, sans changer le fil', async () => {
    const { paul, readers, itemId, commentId } = await giversWorld();
    for (const reader of readers) {
      await report(reader, { targetKind: 'COMMENT', targetId: commentId }).expect(204);
    }
    const [max] = readers;
    if (!max) throw new Error('lecteur absent');
    const seen = (await giversThread(max, itemId)).find((c) => c.id === commentId);
    expect(seen).toMatchObject({ body: '', mentions: [], moderation: 'UNDER_REVIEW' });
    const own = (await giversThread(paul, itemId)).find((c) => c.id === commentId);
    expect(own).toMatchObject({ body: 'Je prends le rouge, qui partage ?', moderation: 'NONE' });
  });
});

describe('File du modérateur (ADM-05, MOD-10)', () => {
  it('un message signalé : texte, motif et fil, rien d’autre', async () => {
    const { lea, paul, readers, itemId, commentId } = await giversWorld();
    const [max] = readers;
    if (!max) throw new Error('lecteur absent');
    await report(max, {
      targetKind: 'COMMENT',
      targetId: commentId,
      reason: 'INAPPROPRIATE',
    }).expect(204);
    const mod = await moderator();
    const entry = (await queue(mod)).find(
      (e) => e.kind === 'COMMENT' && (e.comment as Body).id === commentId,
    );
    expect(entry?.comment).toEqual({
      id: commentId,
      thread: 'GIVERS',
      body: 'Je prends le rouge, qui partage ?',
      createdAt: expect.any(String),
    });
    const text = JSON.stringify(entry);
    for (const secret of [itemId, lea.profileId, paul.profileId, max.profileId]) {
      expect(text).not.toContain(secret);
    }
  });

  it('un utilisateur n’y a pas accès', async () => {
    const user = await person();
    await http().get('/api/v1/admin/moderation/queue').set('Cookie', user.cookie).expect(404);
  });

  it('un modérateur ne tranche pas ce que son compte a signalé : la cible lui est soustraite (ADM-05, revue SEC-40 B1)', async () => {
    const papa = await person();
    const id = await globalProduct(papa);
    const mod = await moderator();
    identity.accounts.seed({ id: mod.accountId, email: `m-${mod.accountId}@lahotte.test` });
    identity.sessions.addAccount(mod.accountId, 'MODERATOR');
    await report(mod, { targetKind: 'PRODUCT', targetId: id }).expect(204);
    const mine = await queue(mod);
    expect(JSON.stringify(mine)).not.toContain(id);
    const res = await http()
      .post(`/api/v1/admin/moderation/products/${id}/decide`)
      .set(mod.mutation)
      .send({ decision: 'KEEP', reason: REASON })
      .expect(409);
    expect(res.body.code).toBe('NOTHING_TO_MODERATE');
    // Un autre modérateur la voit et la tranche.
    const other = await moderator();
    expect(JSON.stringify(await queue(other))).toContain(id);
    await http()
      .post(`/api/v1/admin/moderation/products/${id}/decide`)
      .set(other.mutation)
      .send({ decision: 'KEEP', reason: REASON })
      .expect(204);
  });

  it('rien à décider : 409', async () => {
    const papa = await person();
    const id = await globalProduct(papa);
    const mod = await moderator();
    await http()
      .post(`/api/v1/admin/moderation/products/${id}/decide`)
      .set(mod.mutation)
      .send({ decision: 'KEEP', reason: REASON })
      .expect(409);
  });
});

describe('Retrait, avis et contestation (MOD-10, MOD-11)', () => {
  it('retirer un message : plus lu par personne, auteur averti, contestation tranchée par un autre', async () => {
    const { paul, readers, itemId, commentId } = await giversWorld();
    const [max, zoe] = readers;
    if (!max || !zoe) throw new Error('lecteurs absents');
    await report(max, { targetKind: 'COMMENT', targetId: commentId }).expect(204);
    const first = await moderator();
    await http()
      .post(`/api/v1/admin/moderation/comments/${commentId}/decide`)
      .set(first.mutation)
      .send({ decision: 'REMOVE', reason: REASON })
      .expect(204);
    for (const reader of [paul, max]) {
      const row = (await giversThread(reader, itemId)).find((c) => c.id === commentId);
      expect(row).toMatchObject({ body: '', moderation: 'REMOVED' });
    }
    await conversations.settle();
    const notices = [...conversations.notifications.rows.values()].filter(
      (n) => n.profileId === paul.profileId && n.type === 'moderation.removed',
    );
    expect(notices).toHaveLength(1);

    const mine = await http()
      .get('/api/v1/moderation-decisions')
      .set('Cookie', paul.cookie)
      .expect(200);
    const decision = (mine.body.items as Body[])[0];
    expect(decision).toMatchObject({
      targetKind: 'COMMENT',
      targetId: commentId,
      action: 'REMOVE',
      reason: REASON,
      contested: false,
      canContest: true,
    });
    expect(JSON.stringify(mine.body)).not.toContain(first.accountId);
    const decisionId = decision?.id as string;
    // Seul l'auteur conteste ; un autre reçoit 404.
    await http()
      .post(`/api/v1/moderation-decisions/${decisionId}/contest`)
      .set(zoe.mutation)
      .send({ text: 'Ce n’était pas moi qui avais écrit cela.' })
      .expect(404);
    await http()
      .post(`/api/v1/moderation-decisions/${decisionId}/contest`)
      .set(paul.mutation)
      .send({ text: 'Le message ne visait personne, merci de revoir.' })
      .expect(204);
    await http()
      .post(`/api/v1/moderation-decisions/${decisionId}/contest`)
      .set(paul.mutation)
      .send({ text: 'Une seconde fois, pour voir.' })
      .expect(422);

    const contest = (await queue(first)).find((e) => e.kind === 'CONTEST');
    const contestId = contest?.contestId as string;
    const same = await http()
      .post(`/api/v1/admin/moderation/contests/${contestId}/decide`)
      .set(first.mutation)
      .send({ outcome: 'OVERTURN', reason: REASON })
      .expect(422);
    expect(same.body.code).toBe('CONTEST_SAME_MODERATOR');
    const second = await moderator();
    await http()
      .post(`/api/v1/admin/moderation/contests/${contestId}/decide`)
      .set(second.mutation)
      .send({ outcome: 'OVERTURN', reason: REASON })
      .expect(204);
    const restored = (await giversThread(max, itemId)).find((c) => c.id === commentId);
    expect(restored).toMatchObject({
      body: 'Je prends le rouge, qui partage ?',
      moderation: 'NONE',
    });
  });

  it('retirer et suspendre : la fiche revient au privé et l’auteur ne publie plus au catalogue', async () => {
    const papa = await person();
    const id = await globalProduct(papa);
    await report(await person(), { targetKind: 'PRODUCT', targetId: id }).expect(204);
    const mod = await moderator();
    await http()
      .post(`/api/v1/admin/moderation/products/${id}/decide`)
      .set(mod.mutation)
      .send({ decision: 'REMOVE_AND_SUSPEND', reason: REASON })
      .expect(204);
    expect(catalog.products.rows.get(id)).toMatchObject({
      moderationStatus: 'REJECTED',
      shareLevel: 'PRIVATE',
    });
    const other = await http()
      .post('/api/v1/products')
      .set(papa.mutation)
      .send({ title: 'Autre' })
      .expect(201);
    const res = await http()
      .put(`/api/v1/products/${other.body.id as string}/share`)
      .set(papa.mutation)
      .send({ level: 'GLOBAL' })
      .expect(403);
    expect(res.body.code).toBe('PUBLICATION_SUSPENDED');
  });

  it('le texte d’un message retiré est effacé après le délai de contestation', async () => {
    const { readers, commentId } = await giversWorld();
    const [max] = readers;
    if (!max) throw new Error('lecteur absent');
    await report(max, { targetKind: 'COMMENT', targetId: commentId }).expect(204);
    const mod = await moderator();
    await http()
      .post(`/api/v1/admin/moderation/comments/${commentId}/decide`)
      .set(mod.mutation)
      .send({ decision: 'REMOVE', reason: REASON })
      .expect(204);
    const decision = admin.moderation.decisions.find((d) => d.target.id === commentId);
    if (!decision) throw new Error('décision absente');
    Object.assign(decision, { at: new Date(Date.now() - 15 * 24 * 3600 * 1000) });
    expect(await admin.eraseRemovedComments()).toBe(1);
    expect(conversations.comments.comments.get(commentId)).toMatchObject({
      body: '',
      deletedAt: expect.any(Date),
    });
  });
});
