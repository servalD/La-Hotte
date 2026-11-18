import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile, signIn, type SignedIn } from '../support/sign-in';

// Schéma de la phase 7 (ADR 0021) : tables en ajout seul (DAT-02), contraintes (RGPD-12,
// MOD-11) et sécurité des lignes en défense supplémentaire (DAT-05).

let app: INestApplication;
let prisma: PrismaService;
let recipient: SignedIn;
let giverId: string;
let recipientId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  const own = await createAccountWithProfile(prisma);
  recipient = await signIn(app, own);
  recipientId = own.profileId;
  giverId = (await createAccountWithProfile(prisma)).profileId;
});

afterAll(async () => {
  await app.close();
});

const http = () => request(app.getHttpServer());

/** Wishlist de `recipient`, un souhait et une suggestion d'un offreur. */
async function wishlist(): Promise<{ listId: string; itemId: string; suggestionId: string }> {
  const list = await http()
    .post('/api/v1/lists')
    .set(recipient.mutation)
    .send({ type: 'WISHLIST', title: 'Noël', recipientIds: [recipientId] })
    .expect(201);
  const listId = list.body.id as string;
  const productId = randomUUID();
  await prisma.product.create({
    data: {
      id: productId,
      ownerProfileId: giverId,
      title: 'Fiche',
      currency: 'EUR',
      source: 'MANUAL',
    },
  });
  const itemId = randomUUID();
  const suggestionId = randomUUID();
  const base = { listId, productId, currency: 'EUR', addedByProfileId: giverId };
  await prisma.listItem.create({ data: { ...base, id: itemId, position: 0 } });
  await prisma.listItem.create({
    data: { ...base, id: suggestionId, position: 1, isSuggestion: true },
  });
  return { listId, itemId, suggestionId };
}

function givers(itemId: string) {
  return prisma.comment.create({
    data: {
      id: randomUUID(),
      itemId,
      thread: 'GIVERS',
      kind: 'MESSAGE',
      authorProfileId: giverId,
      body: 'Je prends le rouge',
    },
  });
}

async function engaged(itemId: string): Promise<string> {
  const accountingId = randomUUID();
  await prisma.itemAccounting.create({
    data: { id: accountingId, itemId, currency: 'EUR', plannedTotalMinor: 5_000n },
  });
  await prisma.contribution.create({
    data: {
      id: randomUUID(),
      accountingId,
      profileId: giverId,
      mode: 'FIXED',
      amountMinor: 5_000n,
      rank: 1,
    },
  });
  await prisma.purchase.create({
    data: {
      id: randomUUID(),
      accountingId,
      buyerProfileId: giverId,
      purchasedAt: new Date(),
      raiseUntil: new Date(Date.now() + 86_400_000),
    },
  });
  return accountingId;
}

describe('Tables en ajout seul (DAT-02, AUD-02, MOD-11)', () => {
  it('le rôle applicatif ne peut ni modifier ni supprimer audit_log', async () => {
    const id = randomUUID();
    await prisma.auditLog.create({ data: { id, action: 'account.suspend', reason: 'motif' } });
    await expect(
      prisma.$executeRaw(Prisma.sql`UPDATE audit_log SET reason = 'x' WHERE id = ${id}::uuid`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      prisma.$executeRaw(Prisma.sql`DELETE FROM audit_log WHERE id = ${id}::uuid`),
    ).rejects.toThrow(/permission denied/);
  });

  it('le rôle applicatif ne peut ni modifier ni supprimer moderation_decision', async () => {
    const id = randomUUID();
    await prisma.moderationDecision.create({
      data: {
        id,
        targetKind: 'PRODUCT',
        targetId: randomUUID(),
        action: 'REMOVE',
        reason: 'motif de test',
        actorAccountId: randomUUID(),
      },
    });
    await expect(
      prisma.$executeRaw(
        Prisma.sql`UPDATE moderation_decision SET reason = 'x' WHERE id = ${id}::uuid`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      prisma.$executeRaw(Prisma.sql`DELETE FROM moderation_decision WHERE id = ${id}::uuid`),
    ).rejects.toThrow(/permission denied/);
  });

  it('une contestation exige sa décision, une seule fois (MOD-11)', async () => {
    const base = {
      targetKind: 'COMMENT' as const,
      targetId: randomUUID(),
      reason: 'texte de la contestation',
      actorAccountId: randomUUID(),
    };
    await expect(
      prisma.moderationDecision.create({ data: { ...base, id: randomUUID(), action: 'CONTEST' } }),
    ).rejects.toThrow(/moderation_decision_contest_has_parent/);
    const decision = randomUUID();
    await prisma.moderationDecision.create({ data: { ...base, id: decision, action: 'REMOVE' } });
    await prisma.moderationDecision.create({
      data: { ...base, id: randomUUID(), action: 'CONTEST', parentId: decision },
    });
    await expect(
      prisma.moderationDecision.create({
        data: { ...base, id: randomUUID(), action: 'CONTEST', parentId: decision },
      }),
    ).rejects.toThrow();
  });
});

describe('Effacement du compte (RGPD-12)', () => {
  it('la date de demande accompagne l’état, et lui seul', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    await expect(
      prisma.account.update({
        where: { id: accountId },
        data: { deletionRequestedAt: new Date() },
      }),
    ).rejects.toThrow(/account_deletion_matches_status/);
    await expect(
      prisma.account.update({ where: { id: accountId }, data: { status: 'PENDING_DELETION' } }),
    ).rejects.toThrow(/account_deletion_matches_status/);
    await prisma.account.update({
      where: { id: accountId },
      data: { status: 'PENDING_DELETION', deletionRequestedAt: new Date() },
    });
  });
});

describe('Sécurité des lignes (DAT-05, VIS-20)', () => {
  it('un destinataire ne lit jamais le fil des offreurs, même sur une suggestion', async () => {
    const { itemId, suggestionId } = await wishlist();
    await givers(itemId);
    await givers(suggestionId);
    const read = (viewer: string, item: string) =>
      prisma.asViewer(viewer, (tx) => tx.comment.count({ where: { itemId: item } }));
    expect(await read(recipientId, itemId)).toBe(0);
    expect(await read(recipientId, suggestionId)).toBe(0);
    expect(await read(giverId, itemId)).toBe(1);
    // Sans lecteur (tâches de fond, écritures) : rien n'est écarté.
    expect(await prisma.comment.count({ where: { itemId } })).toBe(1);
  });

  it('un destinataire ne lit ni les parts ni l’achat d’un élément attaché', async () => {
    const { itemId } = await wishlist();
    const accountingId = await engaged(itemId);
    const read = (viewer: string) =>
      prisma.asViewer(viewer, async (tx) => ({
        parts: await tx.contribution.count({ where: { accountingId } }),
        purchase: await tx.purchase.count({ where: { accountingId } }),
      }));
    expect(await read(recipientId)).toEqual({ parts: 0, purchase: 0 });
    expect(await read(giverId)).toEqual({ parts: 1, purchase: 1 });
    expect(await prisma.contribution.count({ where: { accountingId } })).toBe(1);
  });

  it('un destinataire ne lit pas les suggestions de sa wishlist (WSH-04)', async () => {
    const { listId, suggestionId } = await wishlist();
    const ids = (viewer: string) =>
      prisma.asViewer(viewer, async (tx) =>
        (await tx.listItem.findMany({ where: { listId }, select: { id: true } })).map((r) => r.id),
      );
    expect(await ids(recipientId)).not.toContain(suggestionId);
    expect(await ids(giverId)).toContain(suggestionId);
  });

  it('le réglage ne survit pas à sa transaction', async () => {
    const { itemId } = await wishlist();
    await givers(itemId);
    await prisma.asViewer(recipientId, (tx) => tx.comment.count({ where: { itemId } }));
    expect(await prisma.comment.count({ where: { itemId } })).toBe(1);
  });
});
