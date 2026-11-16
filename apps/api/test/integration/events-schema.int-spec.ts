import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createAccountWithProfile } from '../support/sign-in';

// Contraintes de base de la phase 3 (DAT-01, ADR 0017), contre PostgreSQL réel.

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATION_URL });

afterAll(async () => {
  await prisma.$disconnect();
});

async function profile(): Promise<string> {
  return (await createAccountWithProfile(prisma as never)).profileId;
}

async function event(input: {
  creator: string;
  mode: 'EXCHANGE' | 'HONOREE';
  surprise?: boolean;
}): Promise<string> {
  const id = randomUUID();
  await prisma.event.create({
    data: {
      id,
      title: 'Noël',
      date: new Date('2027-12-24'),
      timezone: 'Europe/Paris',
      type: input.mode === 'EXCHANGE' ? 'CHRISTMAS' : 'BIRTHDAY',
      mode: input.mode,
      isSurprise: input.surprise ?? false,
      currency: 'EUR',
      createdBy: input.creator,
    },
  });
  await prisma.eventParticipant.create({
    data: { id: randomUUID(), eventId: id, profileId: input.creator, role: 'ORGANIZER' },
  });
  return id;
}

describe('Schéma des événements (DAT-01)', () => {
  it('EVT-09 : une surprise est « à l’honneur » ; forme et surprise immuables', async () => {
    const creator = await profile();
    await expect(
      prisma.event.create({
        data: {
          id: randomUUID(),
          title: 'Noël',
          date: new Date('2027-12-24'),
          timezone: 'Europe/Paris',
          type: 'CHRISTMAS',
          mode: 'EXCHANGE',
          isSurprise: true,
          currency: 'EUR',
        },
      }),
    ).rejects.toThrow(/event_surprise_is_honoree/);
    const id = await event({ creator, mode: 'HONOREE', surprise: true });
    await expect(
      prisma.event.update({ where: { id }, data: { isSurprise: false } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.event.update({ where: { id }, data: { mode: 'EXCHANGE' } }),
    ).rejects.toThrow(/immutable|event_surprise_is_honoree/);
  });

  it('EVT-05 : titre non vide, budget positif, annulation datée', async () => {
    const creator = await profile();
    const id = await event({ creator, mode: 'EXCHANGE' });
    await expect(prisma.event.update({ where: { id }, data: { title: '  ' } })).rejects.toThrow(
      /event_title_not_blank/,
    );
    await expect(
      prisma.event.update({ where: { id }, data: { suggestedBudgetMinor: 0n } }),
    ).rejects.toThrow(/event_budget_positive/);
    await expect(
      prisma.event.update({ where: { id }, data: { status: 'CANCELLED' } }),
    ).rejects.toThrow(/event_cancelled_at_status/);
  });

  it('EVT-07 : l’honoré d’une surprise n’est jamais participant, dans les deux sens', async () => {
    const creator = await profile();
    const honoree = await profile();
    const giver = await profile();
    const id = await event({ creator, mode: 'HONOREE', surprise: true });
    await prisma.eventSurpriseRecipient.create({
      data: { id: randomUUID(), eventId: id, profileId: honoree },
    });
    await expect(
      prisma.eventParticipant.create({
        data: { id: randomUUID(), eventId: id, profileId: honoree },
      }),
    ).rejects.toThrow(/surprise honoree cannot participate/);
    await prisma.eventParticipant.create({
      data: { id: randomUUID(), eventId: id, profileId: giver },
    });
    await expect(
      prisma.eventSurpriseRecipient.create({
        data: { id: randomUUID(), eventId: id, profileId: giver },
      }),
    ).rejects.toThrow(/participant cannot be a surprise honoree/);
  });

  it('EVT-07 : honoré secret seulement sur une surprise ; marque d’honoré seulement hors surprise', async () => {
    const creator = await profile();
    const other = await profile();
    const exchange = await event({ creator, mode: 'EXCHANGE' });
    await expect(
      prisma.eventSurpriseRecipient.create({
        data: { id: randomUUID(), eventId: exchange, profileId: other },
      }),
    ).rejects.toThrow(/only on a surprise event/);
    await expect(
      prisma.eventParticipant.create({
        data: { id: randomUUID(), eventId: exchange, profileId: other, isHonoree: true },
      }),
    ).rejects.toThrow(/honoree mark only/);
    const surprise = await event({ creator, mode: 'HONOREE', surprise: true });
    await expect(
      prisma.eventParticipant.create({
        data: { id: randomUUID(), eventId: surprise, profileId: other, isHonoree: true },
      }),
    ).rejects.toThrow(/honoree mark only/);
  });

  it('ADR 0017 : insertions concurrentes participant et honoré secret, une seule passe', async () => {
    const creator = await profile();
    const target = await profile();
    const id = await event({ creator, mode: 'HONOREE', surprise: true });
    const results = await Promise.allSettled([
      prisma.eventParticipant.create({
        data: { id: randomUUID(), eventId: id, profileId: target },
      }),
      prisma.eventSurpriseRecipient.create({
        data: { id: randomUUID(), eventId: id, profileId: target },
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('EVT-29 : une liste personnelle n’est jamais rattachée ; suppression de l’événement détache', async () => {
    const creator = await profile();
    const id = await event({ creator, mode: 'EXCHANGE' });
    const personal = randomUUID();
    await expect(
      prisma.list.create({
        data: {
          id: personal,
          type: 'WISHLIST',
          title: 'Mes envies',
          creatorProfileId: creator,
          personalProfileId: creator,
          eventId: id,
          audience: 'CIRCLE',
        },
      }),
    ).rejects.toThrow(/list_personal_no_event/);
    const attached = randomUUID();
    await prisma.list.create({
      data: {
        id: attached,
        type: 'WISHLIST',
        title: 'Noël',
        creatorProfileId: creator,
        eventId: id,
        audience: 'EVENT',
      },
    });
    await prisma.event.delete({ where: { id } });
    expect((await prisma.list.findUnique({ where: { id: attached } }))?.eventId).toBeNull();
  });

  it('EVT-27 : un élément ne se reprend qu’une fois', async () => {
    const creator = await profile();
    const listId = randomUUID();
    await prisma.list.create({
      data: {
        id: listId,
        type: 'WISHLIST',
        title: 'Liste',
        creatorProfileId: creator,
        audience: 'CIRCLE',
      },
    });
    const productId = randomUUID();
    await prisma.product.create({
      data: {
        id: productId,
        ownerProfileId: creator,
        title: 'Fiche',
        currency: 'EUR',
        source: 'MANUAL',
      },
    });
    const base = { listId, productId, currency: 'EUR' };
    const origin = randomUUID();
    await prisma.listItem.create({ data: { ...base, id: origin, position: 0 } });
    await prisma.listItem.create({
      data: { ...base, id: randomUUID(), position: 1, carriedFromItemId: origin },
    });
    await expect(
      prisma.listItem.create({
        data: { ...base, id: randomUUID(), position: 2, carriedFromItemId: origin },
      }),
    ).rejects.toThrow(/carried_from_item_id/);
  });
});
