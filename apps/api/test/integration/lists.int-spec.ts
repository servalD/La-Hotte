import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile, signIn, type SignedIn } from '../support/sign-in';

// Listes contre PostgreSQL réel : critères de requête (VIS-31), candidats, règles, corbeille.

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

/** Lien accepté (LNK-02), paire rangée `a < b`. */
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

async function personal(user: SignedIn): Promise<string> {
  const res = await http().get('/api/v1/lists').set({ Cookie: user.cookie }).expect(200);
  return (res.body.items as Body[]).find((l) => l.personal)!.id as string;
}

async function addItem(user: SignedIn, listId: string, body: Body = {}): Promise<string> {
  const product = await http()
    .post('/api/v1/products')
    .set(user.mutation)
    .send({ title: 'Fiche', unitPriceMinor: 1000 })
    .expect(201);
  const item = await http()
    .post(`/api/v1/lists/${listId}/items`)
    .set(user.mutation)
    .send({ productId: product.body.id, ...body })
    .expect(201);
  return item.body.id as string;
}

async function itemIds(user: SignedIn, listId: string): Promise<string[]> {
  const res = await http().get(`/api/v1/lists/${listId}/items`).set({ Cookie: user.cookie });
  return ((res.body.items as Body[] | undefined) ?? []).map((i) => i.id as string);
}

describe('Listes en base (VIS-31)', () => {
  it('VIS-35 (R4 de la phase 4) : changer la seule position ne fait pas bouger la version', async () => {
    const marie = await person();
    const listId = await personal(marie);
    const a = await addItem(marie, listId);
    await addItem(marie, listId);
    const before = await prisma.listItem.findUniqueOrThrow({ where: { id: a } });
    await http()
      .patch(`/api/v1/items/${a}`)
      .set({ ...marie.mutation, 'If-Match': String(before.version) })
      .send({ position: 1 })
      .expect(200);
    const moved = await prisma.listItem.findUniqueOrThrow({ where: { id: a } });
    expect(moved.position).not.toBe(before.position);
    expect(moved.version).toBe(before.version);
    await http()
      .patch(`/api/v1/items/${a}`)
      .set({ ...marie.mutation, 'If-Match': String(before.version) })
      .send({ note: 'n' })
      .expect(200);
    expect((await prisma.listItem.findUniqueOrThrow({ where: { id: a } })).version).toBe(
      before.version + 1,
    );
  }, 30_000);

  it('« Mes envies » une seule fois, même en lectures concurrentes (WSH-06)', async () => {
    const marie = await person();
    await Promise.all(
      [1, 2, 3].map(() => http().get('/api/v1/lists').set({ Cookie: marie.cookie })),
    );
    expect(await prisma.list.count({ where: { personalProfileId: marie.profileId } })).toBe(1);
  }, 30_000);

  it('les critères de requête appliquent la règle : SEULEMENT, TOUS SAUF, auteur, suggestion', async () => {
    const marie = await person();
    const tonton = await person();
    const mamie = await person();
    await link(marie, tonton);
    await link(marie, mamie);
    const listId = await personal(marie);
    const open = await addItem(marie, listId);
    const onlyMamie = await addItem(marie, listId);
    const exceptMamie = await addItem(marie, listId);
    await prisma.listItem.update({ where: { id: onlyMamie }, data: { visibilityMode: 'ONLY' } });
    await prisma.itemVisibilityProfile.create({
      data: { id: randomUUID(), itemId: onlyMamie, profileId: mamie.profileId! },
    });
    await prisma.listItem.update({
      where: { id: exceptMamie },
      data: { visibilityMode: 'EXCEPT' },
    });
    await prisma.itemVisibilityProfile.create({
      data: { id: randomUUID(), itemId: exceptMamie, profileId: mamie.profileId! },
    });
    const suggestion = await addItem(tonton, listId);

    expect(new Set(await itemIds(marie, listId))).toEqual(new Set([open, onlyMamie, exceptMamie]));
    expect(new Set(await itemIds(mamie, listId))).toEqual(new Set([open, onlyMamie, suggestion]));
    expect(new Set(await itemIds(tonton, listId))).toEqual(
      new Set([open, exceptMamie, suggestion]),
    );
  });

  it('candidats : cercle, membres, sélection ; giftlist cachée absente chez son destinataire', async () => {
    const papa = await person();
    const marie = await person();
    const tonton = await person();
    await link(papa, marie);
    await link(papa, tonton);
    const gift = await http()
      .post('/api/v1/lists')
      .set(papa.mutation)
      .send({ type: 'GIFTLIST', title: 'Pour Marie', recipientIds: [marie.profileId] })
      .expect(201);
    await http()
      .put(`/api/v1/lists/${gift.body.id as string}/members/${tonton.profileId!}`)
      .set(papa.mutation)
      .send({ role: 'READER' })
      .expect(204);
    const papaList = await personal(papa);
    const ofMarie = await http().get('/api/v1/lists').set({ Cookie: marie.cookie }).expect(200);
    expect((ofMarie.body.items as Body[]).map((l) => l.id)).not.toContain(gift.body.id);
    const ofTonton = await http().get('/api/v1/lists').set({ Cookie: tonton.cookie }).expect(200);
    expect((ofTonton.body.items as Body[]).map((l) => l.id)).toContain(gift.body.id);
    // Le cercle de Papa voit sa wishlist personnelle.
    expect((ofTonton.body.items as Body[]).map((l) => l.id)).toContain(papaList);
  });

  it('VIS-10, VIS-14 : règle et journal écrits ensemble ; la règle remplace la précédente', async () => {
    const marie = await person();
    const tonton = await person();
    const mamie = await person();
    await link(marie, tonton);
    await link(marie, mamie);
    const listId = await personal(marie);
    const itemId = await addItem(marie, listId);
    await http()
      .put(`/api/v1/items/${itemId}/visibility`)
      .set({ ...marie.mutation, 'If-Match': '1' })
      .send({ mode: 'EXCEPT', profileIds: [tonton.profileId, mamie.profileId] })
      .expect(200);
    await http()
      .put(`/api/v1/items/${itemId}/visibility`)
      .set({ ...marie.mutation, 'If-Match': '2' })
      .send({ mode: 'ONLY', profileIds: [mamie.profileId] })
      .expect(200);
    const rows = await prisma.itemVisibilityProfile.findMany({ where: { itemId } });
    expect(rows.map((r) => r.profileId)).toEqual([mamie.profileId]);
    expect(await itemIds(tonton, listId)).toEqual([]);
    expect(await itemIds(mamie, listId)).toEqual([itemId]);
    const log = await http()
      .get(`/api/v1/lists/${listId}/visibility-log`)
      .set({ Cookie: marie.cookie })
      .expect(200);
    expect((log.body.items as Body[]).map((e) => (e.after as Body).mode)).toEqual([
      'ONLY',
      'EXCEPT',
    ]);
  });

  it('VIS-40, REP-10 : recherche plein texte en base ; le destinataire d’un cadeau ne voit pas la fiche', async () => {
    const papa = await person();
    const marie = await person();
    const tonton = await person();
    await link(papa, marie);
    await link(papa, tonton);
    const gift = await http()
      .post('/api/v1/lists')
      .set(papa.mutation)
      .send({ type: 'GIFTLIST', title: 'x', recipientIds: [marie.profileId] })
      .expect(201);
    const product = await http()
      .post('/api/v1/products')
      .set(papa.mutation)
      .send({ title: 'Vélo électrique pliant', description: 'Pour les trajets' })
      .expect(201);
    const id = product.body.id as string;
    await http()
      .post(`/api/v1/lists/${gift.body.id as string}/items`)
      .set(papa.mutation)
      .send({ productId: id })
      .expect(201);
    await http()
      .put(`/api/v1/products/${id}/share`)
      .set(papa.mutation)
      .send({ level: 'CIRCLE' })
      .expect(200);
    const search = async (user: SignedIn, q: string) =>
      (
        (
          await http()
            .get(`/api/v1/directory?q=${encodeURIComponent(q)}`)
            .set({ Cookie: user.cookie })
        ).body.items as Body[]
      ).map((e) => e.productId);
    expect(await search(tonton, 'électriques')).toEqual([id]); // racinisation française
    expect(await search(tonton, 'trajet')).toEqual([id]);
    expect(await search(tonton, "'; DROP TABLE product; --")).toEqual([]);
    expect(await search(marie, 'vélo')).toEqual([]);
  });

  it('LST-04 : départ du créateur, LST-20 : corbeille, restauration et purge', async () => {
    const papa = await person();
    const tonton = await person();
    const marie = await person();
    await link(papa, tonton);
    await link(papa, marie);
    const gift = await http()
      .post('/api/v1/lists')
      .set(papa.mutation)
      .send({ type: 'GIFTLIST', title: 'x', recipientIds: [marie.profileId] })
      .expect(201);
    const id = gift.body.id as string;
    await addItem(papa, id);
    await http()
      .put(`/api/v1/lists/${id}/members/${tonton.profileId!}`)
      .set(papa.mutation)
      .send({ role: 'CONTRIBUTOR' })
      .expect(204);
    await http()
      .post(`/api/v1/lists/${id}/leave`)
      .set(papa.mutation)
      .send({ successorProfileId: tonton.profileId })
      .expect(204);
    const row = await prisma.list.findUniqueOrThrow({ where: { id }, include: { members: true } });
    expect(row.creatorProfileId).toBeNull();
    expect(row.members.map((m) => [m.profileId, m.role])).toEqual([[tonton.profileId, 'OWNER']]);
    await http().delete(`/api/v1/lists/${id}`).set(tonton.mutation).expect(204);
    await http().post(`/api/v1/lists/${id}/restore`).set(tonton.mutation).expect(200);
    await http().delete(`/api/v1/lists/${id}`).set(tonton.mutation).expect(204);
    await prisma.list.update({ where: { id }, data: { deletedAt: new Date('2026-01-01') } });
    const { PurgeListTrash } = await import('../../src/modules/lists/application/contract');
    expect(await app.get(PurgeListTrash).execute()).toBeGreaterThanOrEqual(1);
    expect(await prisma.list.count({ where: { id } })).toBe(0);
  });
});

describe('Engagements lus dans la compta (VIS-16, VIS-37, ADR 0019)', () => {
  it('un offreur engagé n’est pas écarté par un autre offreur, mais l’est par la destinataire', async () => {
    const papa = await person();
    const marie = await person();
    const tonton = await person();
    await link(papa, marie);
    await link(papa, tonton);
    await link(marie, tonton);
    const listId = await personal(marie);
    const itemId = await addItem(marie, listId);
    await prisma.listMember.create({
      data: { id: randomUUID(), listId, profileId: papa.profileId!, role: 'OWNER' },
    });
    await prisma.list.update({ where: { id: listId }, data: { visibilityEditRole: 'OWNER' } });
    const accountingId = randomUUID();
    await prisma.itemAccounting.create({
      data: { id: accountingId, itemId, currency: 'EUR', plannedTotalMinor: 1000n },
    });
    await prisma.contribution.create({
      data: {
        id: randomUUID(),
        accountingId,
        profileId: tonton.profileId,
        mode: 'FULL',
        amountMinor: 1000n,
        rank: 1,
      },
    });
    const rule = async (user: SignedIn) => {
      const version = (await prisma.listItem.findUniqueOrThrow({ where: { id: itemId } })).version;
      return http()
        .put(`/api/v1/items/${itemId}/visibility`)
        .set({ ...user.mutation, 'If-Match': String(version) })
        .send({ mode: 'EXCEPT', profileIds: [tonton.profileId] });
    };
    const byPapa = await rule(papa);
    expect(byPapa.body.code).toBe('VISIBILITY_ENGAGED_PROFILE');
    expect((await rule(marie)).status).toBe(200);
  }, 30_000);
});
