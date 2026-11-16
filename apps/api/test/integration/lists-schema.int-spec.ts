import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { createAccountWithProfile } from '../support/sign-in';

// Contraintes de base de la phase 2 (DAT-01, DAT-02), contre PostgreSQL rÃ©el.

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL });

afterAll(async () => {
  await prisma.$disconnect();
});

async function profile(accountId?: string): Promise<{ accountId: string; profileId: string }> {
  if (!accountId) return createAccountWithProfile(prisma as never);
  const profileId = randomUUID();
  await prisma.profile.create({
    data: {
      id: profileId,
      accountId,
      displayName: 'Autre profil',
      accentColor: '#336699',
      locale: 'fr',
      currency: 'EUR',
      timezone: 'Europe/Paris',
    },
  });
  return { accountId, profileId };
}

async function list(input: {
  type: 'WISHLIST' | 'GIFTLIST';
  creator: string;
  personal?: boolean;
}): Promise<string> {
  const id = randomUUID();
  await prisma.list.create({
    data: {
      id,
      type: input.type,
      title: 'Liste',
      creatorProfileId: input.creator,
      personalProfileId: input.personal ? input.creator : null,
      audience: input.type === 'WISHLIST' ? 'CIRCLE' : 'MEMBERS',
    },
  });
  await prisma.listMember.create({
    data: { id: randomUUID(), listId: id, profileId: input.creator, role: 'CREATOR' },
  });
  return id;
}

async function product(owner: string): Promise<string> {
  const id = randomUUID();
  await prisma.product.create({
    data: { id, ownerProfileId: owner, title: 'Fiche', currency: 'EUR', source: 'MANUAL' },
  });
  return id;
}

describe('SchÃ©ma des listes (DAT-01)', () => {
  it('GFT-04 : contenu montrÃ© sans existence rÃ©vÃ©lÃ©e refusÃ©', async () => {
    const { profileId } = await profile();
    const id = await list({ type: 'GIFTLIST', creator: profileId });
    await expect(
      prisma.list.update({ where: { id }, data: { giftContent: 'FULL' } }),
    ).rejects.toThrow(/list_gift_content_revealed/);
  });

  it('LST-02 : un seul crÃ©ateur par liste', async () => {
    const a = await profile();
    const b = await profile(a.accountId);
    const id = await list({ type: 'WISHLIST', creator: a.profileId });
    await expect(
      prisma.listMember.create({
        data: { id: randomUUID(), listId: id, profileId: b.profileId, role: 'CREATOR' },
      }),
    ).rejects.toThrow(/Unique constraint failed on the fields: \(`list_id`\)/);
  });

  it('GFT-01 : un destinataire de giftlist ne peut pas en Ãªtre membre, dans les deux sens', async () => {
    const a = await profile();
    const b = await profile();
    const id = await list({ type: 'GIFTLIST', creator: a.profileId });
    await prisma.listRecipient.create({
      data: { id: randomUUID(), listId: id, profileId: b.profileId },
    });
    await expect(
      prisma.listMember.create({
        data: { id: randomUUID(), listId: id, profileId: b.profileId, role: 'READER' },
      }),
    ).rejects.toThrow(/recipient cannot be a member/);
    await expect(
      prisma.listRecipient.create({
        data: { id: randomUUID(), listId: id, profileId: a.profileId },
      }),
    ).rejects.toThrow(/member cannot be a recipient/);
  });

  it('WSH-04 : suggestion sur une wishlist seulement ; type de liste immuable', async () => {
    const { profileId } = await profile();
    const gift = await list({ type: 'GIFTLIST', creator: profileId });
    const productId = await product(profileId);
    await expect(
      prisma.listItem.create({
        data: {
          id: randomUUID(),
          listId: gift,
          productId,
          currency: 'EUR',
          position: 0,
          isSuggestion: true,
        },
      }),
    ).rejects.toThrow(/suggestion only on a wishlist/);
    await expect(
      prisma.list.update({ where: { id: gift }, data: { type: 'WISHLIST' } }),
    ).rejects.toThrow(/list type is immutable/);
  });

  it('ART-10, LST-19 : quantitÃ© â‰¥ 1, prix â‰¥ 0, motif exigÃ© pour un retrait', async () => {
    const { profileId } = await profile();
    const id = await list({ type: 'WISHLIST', creator: profileId });
    const productId = await product(profileId);
    const base = { listId: id, productId, currency: 'EUR', position: 0 };
    await expect(
      prisma.listItem.create({ data: { ...base, id: randomUUID(), quantity: 0 } }),
    ).rejects.toThrow(/list_item_quantity_positive/);
    await expect(
      prisma.listItem.create({ data: { ...base, id: randomUUID(), unitPriceMinor: -1n } }),
    ).rejects.toThrow(/list_item_price_non_negative/);
    await expect(
      prisma.listItem.create({ data: { ...base, id: randomUUID(), status: 'WITHDRAWN' } }),
    ).rejects.toThrow(/list_item_withdrawn_reason/);
  });

  it('WSH-06 : une seule Â« Mes envies Â» par profil', async () => {
    const { profileId } = await profile();
    await list({ type: 'WISHLIST', creator: profileId, personal: true });
    await expect(list({ type: 'WISHLIST', creator: profileId, personal: true })).rejects.toThrow(
      /personal_profile_id/,
    );
  });
});

describe('Suppression dâ€™un profil (PRO-06, LST-04)', () => {
  it('Â« Mes envies Â» passe Ã  la corbeille ; le plus ancien contributeur devient responsable', async () => {
    const owner = await profile();
    const contributor = await profile();
    const later = await profile();
    const personal = await list({ type: 'WISHLIST', creator: owner.profileId, personal: true });
    const shared = await list({ type: 'GIFTLIST', creator: owner.profileId });
    await prisma.listMember.create({
      data: {
        id: randomUUID(),
        listId: shared,
        profileId: contributor.profileId,
        role: 'CONTRIBUTOR',
        createdAt: new Date('2026-01-01'),
      },
    });
    await prisma.listMember.create({
      data: { id: randomUUID(), listId: shared, profileId: later.profileId, role: 'CONTRIBUTOR' },
    });
    const productId = await product(owner.profileId);
    await prisma.listItem.create({
      data: { id: randomUUID(), listId: shared, productId, currency: 'EUR', position: 0 },
    });

    await prisma.profile.delete({ where: { id: owner.profileId } });

    expect((await prisma.list.findUnique({ where: { id: personal } }))?.deletedAt).not.toBeNull();
    const heir = await prisma.listMember.findUnique({
      where: { listId_profileId: { listId: shared, profileId: contributor.profileId } },
    });
    expect(heir?.role).toBe('OWNER');
    const sharedRow = await prisma.list.findUnique({ where: { id: shared } });
    expect(sharedRow?.creatorProfileId).toBeNull();
    expect(sharedRow?.archivedAt).toBeNull();
    // La fiche reste pour l'Ã©lÃ©ment qui la rÃ©fÃ©rence, sans propriÃ©taire.
    expect(
      (await prisma.product.findUnique({ where: { id: productId } }))?.ownerProfileId,
    ).toBeNull();
  });

  it('sans membre pour lui succÃ©der, la liste est archivÃ©e', async () => {
    const owner = await profile();
    const id = await list({ type: 'GIFTLIST', creator: owner.profileId });
    await prisma.profile.delete({ where: { id: owner.profileId } });
    expect((await prisma.list.findUnique({ where: { id } }))?.archivedAt).not.toBeNull();
  });
});

describe('Journal des rÃ¨gles de visibilitÃ© (DAT-02)', () => {
  it('le rÃ´le applicatif ne peut ni modifier ni supprimer visibility_change_log', async () => {
    const appRole = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    try {
      const id = randomUUID();
      await appRole.visibilityChangeLog.create({
        data: { id, listId: randomUUID(), changedBy: randomUUID(), before: {}, after: {} },
      });
      await expect(
        appRole.$executeRaw(
          Prisma.sql`UPDATE visibility_change_log SET changed_by = gen_random_uuid() WHERE id = ${id}::uuid`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        appRole.$executeRaw(Prisma.sql`DELETE FROM visibility_change_log WHERE id = ${id}::uuid`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await appRole.$disconnect();
    }
  });
});
