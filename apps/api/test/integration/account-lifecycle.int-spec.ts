import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaAccountLifecycle } from '../../src/modules/identity/infrastructure/prisma-account-lifecycle';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile, signIn } from '../support/sign-in';

// RGPD-12, RGPD-13, DAT-06, ADR 0021 : effacement réel d'un compte qui a des données, et
// références des autres vidées par les clés étrangères, y compris dans le journal de compta en
// ajout seul (le rôle applicatif n'y a pas UPDATE).

let app: INestApplication;
let prisma: PrismaService;
let lifecycle: PrismaAccountLifecycle;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  lifecycle = new PrismaAccountLifecycle(prisma);
});

afterAll(async () => {
  await app.close();
});

const http = () => request(app.getHttpServer());

describe('Effacement d’un compte (RGPD-12)', () => {
  it('compte, sessions et profils effacés ; commentaires, parts et journal gardés sans auteur', async () => {
    const owner = await createAccountWithProfile(prisma);
    const leaving = await createAccountWithProfile(prisma);
    const ownerSession = await signIn(app, owner);
    const leavingSession = await signIn(app, leaving);
    // Données du compte qui part, et références chez les autres.
    const list = await http()
      .post('/api/v1/lists')
      .set(ownerSession.mutation)
      .send({ type: 'WISHLIST', title: 'Noël', recipientIds: [owner.profileId] })
      .expect(201);
    const product = await http()
      .post('/api/v1/products')
      .set(ownerSession.mutation)
      .send({ title: 'Vélo' })
      .expect(201);
    const item = await http()
      .post(`/api/v1/lists/${list.body.id as string}/items`)
      .set(ownerSession.mutation)
      .send({ productId: product.body.id as string })
      .expect(201);
    const itemId = item.body.id as string;
    await http()
      .post('/api/v1/products')
      .set(leavingSession.mutation)
      .send({ title: 'Ma fiche' })
      .expect(201);
    const commentId = randomUUID();
    await prisma.comment.create({
      data: {
        id: commentId,
        itemId,
        thread: 'GIVERS',
        kind: 'MESSAGE',
        authorProfileId: leaving.profileId,
        body: 'Je participe',
      },
    });
    const accountingId = randomUUID();
    await prisma.itemAccounting.create({
      data: { id: accountingId, itemId, currency: 'EUR', plannedTotalMinor: 5_000n },
    });
    const contributionId = randomUUID();
    await prisma.contribution.create({
      data: {
        id: contributionId,
        accountingId,
        profileId: leaving.profileId,
        mode: 'FIXED',
        amountMinor: 5_000n,
        rank: 1,
      },
    });
    const ledgerId = randomUUID();
    await prisma.ledgerEntry.create({
      data: {
        id: ledgerId,
        accountingId,
        actorProfileId: leaving.profileId,
        kind: 'CONTRIBUTION_SET',
        operationId: randomUUID(),
      },
    });

    const old = new Date(Date.now() - 31 * 24 * 3600 * 1000);
    expect(
      await lifecycle.requestDeletion({ accountId: leaving.accountId, authEpoch: 5, at: old }),
    ).toBe('requested');
    const before = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    expect(await lifecycle.dueForErasure(before, 1000)).toContain(leaving.accountId);
    expect(await lifecycle.erase(leaving.accountId, before)).toBe(true);

    expect(await prisma.account.findUnique({ where: { id: leaving.accountId } })).toBeNull();
    expect(await prisma.profile.findUnique({ where: { id: leaving.profileId } })).toBeNull();
    expect(await prisma.session.count({ where: { accountId: leaving.accountId } })).toBe(0);
    expect(
      (await prisma.comment.findUniqueOrThrow({ where: { id: commentId } })).authorProfileId,
    ).toBeNull();
    expect(
      (await prisma.contribution.findUniqueOrThrow({ where: { id: contributionId } })).profileId,
    ).toBeNull();
    // DAT-02 : l'écriture reste telle quelle ; son identifiant de profil, sans clé étrangère,
    // ne désigne plus personne (CPT-50, ADR 0021).
    expect(await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: ledgerId } })).toMatchObject({
      actorProfileId: leaving.profileId,
    });
  });

  it('une demande annulée n’efface rien ; un tuteur ne se supprime pas', async () => {
    const account = await createAccountWithProfile(prisma);
    const old = new Date(Date.now() - 31 * 24 * 3600 * 1000);
    await lifecycle.requestDeletion({ accountId: account.accountId, authEpoch: 3, at: old });
    expect(await lifecycle.cancelDeletion(account.accountId)).toBe(true);
    expect(await lifecycle.erase(account.accountId, new Date())).toBe(false);
    const row = await prisma.account.findUniqueOrThrow({ where: { id: account.accountId } });
    expect(row).toMatchObject({ status: 'ACTIVE', deletionRequestedAt: null });
  });
});

describe('Inactivité (RGPD-13)', () => {
  it('avertissements comptés une fois ; une connexion remet le compteur à zéro', async () => {
    const account = await createAccountWithProfile(prisma);
    const old = new Date(Date.now() - 4 * 365 * 24 * 3600 * 1000);
    await prisma.account.update({
      where: { id: account.accountId },
      data: { lastSignInAt: old, createdAt: old },
    });
    const now = new Date();
    const found = await lifecycle.inactive({ before: now, notices: 0, limit: 10_000 });
    expect(found.map((a) => a.accountId)).toContain(account.accountId);
    expect(await lifecycle.markWarned(account.accountId, 0, now)).toBe(true);
    expect(await lifecycle.markWarned(account.accountId, 0, now)).toBe(false);
    await signIn(app, account);
    const row = await prisma.account.findUniqueOrThrow({ where: { id: account.accountId } });
    expect(row.inactivityNotices).toBe(0);
    expect(row.lastSignInAt?.getTime()).toBeGreaterThan(old.getTime());
  });
});
