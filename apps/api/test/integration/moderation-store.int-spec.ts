import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaModerationStore } from '../../src/modules/admin/infrastructure/prisma-moderation-store';
import type { DecisionRecord } from '../../src/modules/admin/domain/moderation';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import type { AuditWrite } from '../../src/shared/domain';
import { createAccountWithProfile, signIn, type SignedIn } from '../support/sign-in';

// Magasin de la modération en base : MOD-07 (un signalement par profil, seuil par comptes),
// MOD-10 (décision, clôture et audit ensemble, AUD-05), MOD-11 (une contestation, effacement).

let app: INestApplication;
let prisma: PrismaService;
let store: PrismaModerationStore;
let author: SignedIn;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  store = new PrismaModerationStore(prisma);
  author = await signIn(app, await createAccountWithProfile(prisma));
});

afterAll(async () => {
  await app.close();
});

const http = () => request(app.getHttpServer());

async function authoredComment(): Promise<string> {
  const list = await http()
    .post('/api/v1/lists')
    .set(author.mutation)
    .send({ type: 'WISHLIST', title: 'Noël', recipientIds: [author.profileId] })
    .expect(201);
  const product = await http()
    .post('/api/v1/products')
    .set(author.mutation)
    .send({ title: 'Vélo' })
    .expect(201);
  const item = await http()
    .post(`/api/v1/lists/${list.body.id as string}/items`)
    .set(author.mutation)
    .send({ productId: product.body.id as string })
    .expect(201);
  const id = randomUUID();
  await prisma.comment.create({
    data: {
      id,
      itemId: item.body.id as string,
      thread: 'PUBLIC',
      kind: 'MESSAGE',
      authorProfileId: author.profileId,
      body: 'Un message à modérer',
    },
  });
  return id;
}

const audit = (targetId: string): AuditWrite => ({
  id: randomUUID(),
  at: new Date(),
  entry: {
    actorAccountId: randomUUID(),
    action: 'moderation.decide',
    targetKind: 'COMMENT',
    targetId,
    reason: 'motif de test suffisant',
    ip: null,
  },
});

const decision = (targetId: string, at = new Date()): DecisionRecord => ({
  id: randomUUID(),
  target: { kind: 'COMMENT', id: targetId },
  action: 'REMOVE',
  reason: 'motif de test suffisant',
  actorAccountId: randomUUID(),
  parentId: null,
  at,
});

describe('Signalements (MOD-07, MOD-08)', () => {
  it('un profil signale une fois ; le seuil compte des comptes distincts', async () => {
    const commentId = await authoredComment();
    const target = { kind: 'COMMENT' as const, id: commentId };
    const a = await createAccountWithProfile(prisma);
    const b = await createAccountWithProfile(prisma);
    const report = (profileId: string, accountId: string) =>
      store.addReport({
        id: randomUUID(),
        reporterProfileId: profileId,
        reporterAccountId: accountId,
        target,
        reason: 'SPAM',
        note: null,
        at: new Date(),
      });
    expect(await report(a.profileId, a.accountId)).toEqual({ created: true, distinctAccounts: 1 });
    expect(await report(a.profileId, a.accountId)).toEqual({ created: false, distinctAccounts: 1 });
    expect(await report(b.profileId, b.accountId)).toEqual({ created: true, distinctAccounts: 2 });
    expect((await store.openReportsOn(target))?.reasons).toEqual([{ reason: 'SPAM', count: 2 }]);
  });
});

describe('Décisions et contestations (MOD-10, MOD-11, AUD-05)', () => {
  it('décision, clôture des signalements et audit ensemble ; une seule contestation', async () => {
    const commentId = await authoredComment();
    const reporter = await createAccountWithProfile(prisma);
    await store.addReport({
      id: randomUUID(),
      reporterProfileId: reporter.profileId,
      reporterAccountId: reporter.accountId,
      target: { kind: 'COMMENT', id: commentId },
      reason: 'OTHER',
      note: 'note',
      at: new Date(),
    });
    const removal = decision(commentId);
    await store.record({ decision: removal, audit: audit(commentId), closeReports: true });
    expect(await store.openReportsOn({ kind: 'COMMENT', id: commentId })).toBeNull();
    expect(await prisma.auditLog.count({ where: { targetId: commentId } })).toBe(1);
    const mine = await store.decisionsOnContentOf(author.profileId ?? '');
    expect(mine.find((d) => d.id === removal.id)).toMatchObject({ contested: false });
    const contest = { ...decision(commentId), action: 'CONTEST' as const, parentId: removal.id };
    expect(await store.contest(contest)).toBe('created');
    expect(await store.contest({ ...contest, id: randomUUID() })).toBe('already');
    expect((await store.openContests(50)).some((c) => c.contest.id === contest.id)).toBe(true);
  });

  it('deux modérateurs à la fois : une seule décision, une seule réponse à la contestation (MOD-10, MOD-11)', async () => {
    const commentId = await authoredComment();
    const target = { kind: 'COMMENT' as const, id: commentId };
    const expected = await store.lastDecisionOn(target);
    const keep = { ...decision(commentId), action: 'KEEP' as const };
    const remove = decision(commentId);
    const results = await Promise.all(
      [keep, remove].map((d) =>
        store.record({
          decision: d,
          audit: audit(commentId),
          closeReports: true,
          expectedLastDecisionId: expected,
        }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await prisma.moderationDecision.count({ where: { targetId: commentId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { targetId: commentId } })).toBe(1);

    const first = results[0] ? keep : remove;
    const contest = { ...decision(commentId), action: 'CONTEST' as const, parentId: first.id };
    expect(await store.contest(contest)).toBe('created');
    const ruling = (action: 'KEEP' | 'REMOVE') => ({
      ...decision(commentId),
      action,
      parentId: contest.id,
    });
    const rulings = await Promise.all(
      [ruling('KEEP'), ruling('REMOVE')].map((d) =>
        store.record({ decision: d, audit: audit(commentId), closeReports: false }),
      ),
    );
    expect(rulings.filter(Boolean)).toHaveLength(1);
    expect(await prisma.moderationDecision.count({ where: { parentId: contest.id } })).toBe(1);
  });

  it('cibles disparues : ni signalements ni contestations dans la file (MOD-10, MOD-11)', async () => {
    const commentId = await authoredComment();
    const target = { kind: 'COMMENT' as const, id: commentId };
    const reporter = await createAccountWithProfile(prisma);
    await store.addReport({
      id: randomUUID(),
      reporterProfileId: reporter.profileId,
      reporterAccountId: reporter.accountId,
      target,
      reason: 'SPAM',
      note: null,
      at: new Date(),
    });
    const removal = decision(commentId);
    await store.record({ decision: removal, audit: audit(commentId), closeReports: false });
    const contest = { ...decision(commentId), action: 'CONTEST' as const, parentId: removal.id };
    expect(await store.contest(contest)).toBe('created');
    const listed = async () => ({
      report: (await store.openReports(1000)).some((r) => r.target.id === commentId),
      contest: (await store.openContests(1000)).some((c) => c.contest.id === contest.id),
    });
    expect(await listed()).toEqual({ report: true, contest: true });
    expect(await store.contestOpen(contest.id)).toBe(true);
    await prisma.comment.update({
      where: { id: commentId },
      data: { deletedAt: new Date(), body: '' },
    });
    expect(await listed()).toEqual({ report: false, contest: false });
  });

  it('audit refusé : la décision n’est pas écrite', async () => {
    const commentId = await authoredComment();
    const broken = audit(commentId);
    const removal = decision(commentId);
    await expect(
      store.record({
        decision: removal,
        audit: { ...broken, entry: { ...broken.entry, ip: 'pas-une-adresse' } },
        closeReports: true,
      }),
    ).rejects.toThrow();
    expect(await store.findDecision(removal.id)).toBeNull();
  });

  it('un message retiré est à effacer après le délai, sauf contestation ouverte', async () => {
    const old = new Date(Date.now() - 15 * 24 * 3600 * 1000);
    const erased = await authoredComment();
    const contested = await authoredComment();
    for (const id of [erased, contested]) {
      await prisma.comment.update({ where: { id }, data: { moderatedAt: old } });
    }
    await store.record({
      decision: decision(erased, old),
      audit: audit(erased),
      closeReports: true,
    });
    const removal = decision(contested, old);
    await store.record({ decision: removal, audit: audit(contested), closeReports: true });
    await store.contest({ ...decision(contested), action: 'CONTEST', parentId: removal.id });
    const ids = await store.commentsToErase(new Date(Date.now() - 14 * 24 * 3600 * 1000));
    expect(ids).toContain(erased);
    expect(ids).not.toContain(contested);
  });
});
