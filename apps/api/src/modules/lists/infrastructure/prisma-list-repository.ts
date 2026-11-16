import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import type { ItemCriteria, ItemRecord, ListCandidateCriteria, ListRole } from '../../visibility';
import type { ItemChanges, ItemSort, ListRecord, WithdrawnReason } from '../domain/list';
import {
  type CarryCandidate,
  EngagementReader,
  type EventForLists,
  EventLookup,
  ItemRepository,
  type ItemProductReference,
  type ListChanges,
  ListRepository,
  type NewItem,
  type NewList,
  type RuleLogEntry,
  type RuleSnapshot,
  VisibilityLogRepository,
} from '../domain/list.ports';

const LIST_INCLUDE = {
  recipients: { select: { profileId: true } },
  members: { select: { profileId: true, role: true, createdAt: true } },
  audienceOf: { select: { profileId: true } },
  // EVT-14, EVT-38 : audience et clôture de l'événement de rattachement.
  event: {
    select: {
      id: true,
      status: true,
      participants: {
        where: { rsvp: { in: ['YES', 'MAYBE'] } },
        select: { profileId: true },
      },
    },
  },
} satisfies Prisma.ListInclude;

type ListRow = Prisma.ListGetPayload<{ include: typeof LIST_INCLUDE }>;

function toList(row: ListRow): ListRecord {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    personalProfileId: row.personalProfileId,
    event: row.event
      ? {
          id: row.event.id,
          audience: row.event.participants.map((p) => p.profileId),
          closed: row.event.status !== 'UPCOMING',
        }
      : null,
    audience: row.audience,
    recipients: row.recipients.map((r) => r.profileId),
    members: row.members.map((m) => ({ profileId: m.profileId, role: m.role, since: m.createdAt })),
    customAudience: row.audienceOf.map((a) => a.profileId),
    defaultItemVisibility: row.defaultItemVisibility,
    visibilityEditRole: row.visibilityEditRole,
    giftExistence: row.giftExistence,
    giftContent: row.giftContent,
    archivedAt: row.archivedAt,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    version: row.version,
  };
}

function logData(entry: RuleLogEntry): Prisma.VisibilityChangeLogCreateInput {
  return {
    id: entry.id,
    listId: entry.listId,
    itemId: entry.itemId,
    changedBy: entry.changedBy,
    before: { mode: entry.before.mode, profiles: [...entry.before.profiles] },
    after: { mode: entry.after.mode, profiles: [...entry.after.profiles] },
    at: entry.at,
  };
}

/** EVT-29 : lecture d'un événement par `lists`, sans dépendre du module `events`. */
@Injectable()
export class PrismaEventLookup extends EventLookup {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async find(eventId: string): Promise<EventForLists | null> {
    const row = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        mode: true,
        isSurprise: true,
        status: true,
        participants: { select: { profileId: true, role: true, isHonoree: true, rsvp: true } },
      },
    });
    return row;
  }

  async surpriseRecipients(eventId: string): Promise<string[]> {
    const rows = await this.prisma.eventSurpriseRecipient.findMany({
      where: { eventId },
      select: { profileId: true },
    });
    return rows.map((row) => row.profileId);
  }
}

@Injectable()
export class PrismaListRepository extends ListRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async ensurePersonal(input: {
    profileId: string;
    listId: string;
    memberId: string;
    recipientId: string;
    title: string;
  }): Promise<void> {
    const existing = await this.prisma.list.findUnique({
      where: { personalProfileId: input.profileId },
      select: { id: true },
    });
    if (existing) return;
    try {
      await this.prisma.$transaction([
        this.prisma.list.create({
          data: {
            id: input.listId,
            type: 'WISHLIST',
            title: input.title,
            creatorProfileId: input.profileId,
            personalProfileId: input.profileId,
            audience: 'CIRCLE',
          },
        }),
        this.prisma.listMember.create({
          data: {
            id: input.memberId,
            listId: input.listId,
            profileId: input.profileId,
            role: 'CREATOR',
          },
        }),
        this.prisma.listRecipient.create({
          data: { id: input.recipientId, listId: input.listId, profileId: input.profileId },
        }),
      ]);
    } catch (error) {
      // WSH-06 : une lecture concurrente l'a créée (unicité de `personal_profile_id`).
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'))
        throw error;
    }
  }

  async create(list: NewList): Promise<ListRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.list.create({
        data: {
          id: list.id,
          type: list.type,
          title: list.title,
          description: list.description,
          creatorProfileId: list.creatorProfileId,
          personalProfileId: list.personal ? list.creatorProfileId : null,
          eventId: list.eventId ?? null,
          audience: list.audience,
          giftExistence: list.giftExistence,
          giftContent: list.giftContent,
        },
      });
      await tx.listMember.create({
        data: {
          id: list.creatorMemberId,
          listId: list.id,
          profileId: list.creatorProfileId,
          role: 'CREATOR',
        },
      });
      for (const recipient of list.recipients) {
        await tx.listRecipient.create({
          data: { id: recipient.id, listId: list.id, profileId: recipient.profileId },
        });
      }
      for (const entry of list.customAudience) {
        await tx.listAudienceProfile.create({
          data: { id: entry.id, listId: list.id, profileId: entry.profileId },
        });
      }
      return tx.list.findUniqueOrThrow({ where: { id: list.id }, include: LIST_INCLUDE });
    });
    return toList(row);
  }

  async find(listId: string): Promise<ListRecord | null> {
    const row = await this.prisma.list.findUnique({ where: { id: listId }, include: LIST_INCLUDE });
    return row ? toList(row) : null;
  }

  async findCandidates(criteria: ListCandidateCriteria): Promise<ListRecord[]> {
    const viewer = criteria.viewerId;
    const rows = await this.prisma.list.findMany({
      where: {
        deletedAt: null,
        OR: [
          { members: { some: { profileId: viewer } } },
          { recipients: { some: { profileId: viewer } } },
          ...(criteria.circle.length > 0
            ? [
                {
                  audience: 'CIRCLE' as const,
                  recipients: { some: { profileId: { in: [...criteria.circle] } } },
                },
              ]
            : []),
          { audience: 'CUSTOM', audienceOf: { some: { profileId: viewer } } },
          // VIS-03, EVT-14 : listes d'un événement où il a répondu Participe ou Peut-être.
          {
            audience: 'EVENT',
            event: {
              participants: { some: { profileId: viewer, rsvp: { in: ['YES', 'MAYBE'] } } },
            },
          },
        ],
      },
      include: LIST_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    return rows.map(toList);
  }

  async findTrash(profileId: string): Promise<ListRecord[]> {
    const rows = await this.prisma.list.findMany({
      where: {
        deletedAt: { not: null },
        members: { some: { profileId, role: { in: ['CREATOR', 'OWNER'] } } },
      },
      include: LIST_INCLUDE,
      orderBy: [{ deletedAt: 'desc' }],
    });
    return rows.map(toList);
  }

  async update(input: {
    listId: string;
    expectedVersion: number;
    changes: ListChanges;
    now: Date;
    log?: RuleLogEntry;
  }): Promise<ListRecord | 'version' | 'missing'> {
    const { changes } = input;
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.list.updateMany({
        where: { id: input.listId, version: input.expectedVersion },
        data: {
          ...(changes.title !== undefined ? { title: changes.title } : {}),
          ...(changes.description !== undefined ? { description: changes.description } : {}),
          ...(changes.audience !== undefined ? { audience: changes.audience } : {}),
          ...(changes.defaultItemVisibility !== undefined
            ? { defaultItemVisibility: changes.defaultItemVisibility }
            : {}),
          ...(changes.visibilityEditRole !== undefined
            ? { visibilityEditRole: changes.visibilityEditRole }
            : {}),
          ...(changes.giftExistence !== undefined ? { giftExistence: changes.giftExistence } : {}),
          ...(changes.giftContent !== undefined ? { giftContent: changes.giftContent } : {}),
          ...(changes.archived !== undefined
            ? { archivedAt: changes.archived ? input.now : null }
            : {}),
          version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        const exists = await tx.list.count({ where: { id: input.listId } });
        return exists ? 'version' : 'missing';
      }
      if (input.log) await tx.visibilityChangeLog.create({ data: logData(input.log) });
      if (changes.recipients) {
        await tx.listRecipient.deleteMany({ where: { listId: input.listId } });
        for (const r of changes.recipients) {
          await tx.listRecipient.create({
            data: { id: r.id, listId: input.listId, profileId: r.profileId },
          });
        }
      }
      if (changes.customAudience) {
        await tx.listAudienceProfile.deleteMany({ where: { listId: input.listId } });
        for (const a of changes.customAudience) {
          await tx.listAudienceProfile.create({
            data: { id: a.id, listId: input.listId, profileId: a.profileId },
          });
        }
      }
      return toList(
        await tx.list.findUniqueOrThrow({ where: { id: input.listId }, include: LIST_INCLUDE }),
      );
    });
  }

  async setMember(input: {
    listId: string;
    id: string;
    profileId: string;
    role: Exclude<ListRole, 'CREATOR'>;
  }): Promise<void> {
    await this.prisma.listMember.upsert({
      where: { listId_profileId: { listId: input.listId, profileId: input.profileId } },
      create: { id: input.id, listId: input.listId, profileId: input.profileId, role: input.role },
      update: { role: input.role },
    });
  }

  async removeMember(listId: string, profileId: string): Promise<boolean> {
    const result = await this.prisma.listMember.deleteMany({
      where: { listId, profileId, role: { not: 'CREATOR' } },
    });
    return result.count > 0;
  }

  async leave(input: {
    listId: string;
    profileId: string;
    successorId: string | null;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (input.successorId) {
        await tx.listMember.update({
          where: { listId_profileId: { listId: input.listId, profileId: input.successorId } },
          data: { role: 'OWNER' },
        });
        await tx.list.updateMany({
          where: { id: input.listId, creatorProfileId: input.profileId },
          data: { creatorProfileId: null, version: { increment: 1 } },
        });
      }
      await tx.listMember.deleteMany({
        where: { listId: input.listId, profileId: input.profileId },
      });
    });
  }

  async attachEvent(listId: string, eventId: string): Promise<boolean> {
    const { count } = await this.prisma.list.updateMany({
      where: { id: listId, eventId: null, personalProfileId: null, deletedAt: null },
      data: { eventId, version: { increment: 1 } },
    });
    return count === 1;
  }

  async detachEvent(listId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.list.updateMany({
        where: { id: listId, audience: 'EVENT' },
        data: { audience: 'MEMBERS' },
      }),
      this.prisma.list.updateMany({
        where: { id: listId, eventId: { not: null } },
        data: { eventId: null, version: { increment: 1 } },
      }),
    ]);
  }

  async findEventWishlist(eventId: string, profileId: string): Promise<string | null> {
    const row = await this.prisma.list.findFirst({
      where: {
        eventId,
        type: 'WISHLIST',
        deletedAt: null,
        creatorProfileId: profileId,
        recipients: { some: { profileId } },
      },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return row?.id ?? null;
  }

  async trash(listId: string, at: Date): Promise<void> {
    await this.prisma.list.updateMany({
      where: { id: listId, deletedAt: null, personalProfileId: null },
      data: { deletedAt: at, version: { increment: 1 } },
    });
  }

  async restore(listId: string): Promise<void> {
    await this.prisma.list.updateMany({
      where: { id: listId, deletedAt: { not: null } },
      data: { deletedAt: null, version: { increment: 1 } },
    });
  }

  async purgeTrash(before: Date): Promise<number> {
    const result = await this.prisma.list.deleteMany({ where: { deletedAt: { lt: before } } });
    return result.count;
  }
}

const ITEM_INCLUDE = {
  product: {
    select: {
      id: true,
      title: true,
      description: true,
      imageKey: true,
      merchant: true,
      sourceUrl: true,
    },
  },
  ruleProfiles: { select: { profileId: true } },
  // EVT-27, EVT-28 : reprise ; l'état de l'origine ne sort que par la vue offreur.
  carriedTo: { select: { id: true } },
  carriedFrom: {
    select: {
      status: true,
      list: { select: { event: { select: { id: true, title: true, date: true } } } },
    },
  },
} satisfies Prisma.ListItemInclude;

type ItemRow = Prisma.ListItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

/** EVT-05 : un jour sans heure, rendu `AAAA-MM-JJ`. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toItem(row: ItemRow): ItemRecord {
  return {
    id: row.id,
    listId: row.listId,
    product: row.product,
    quantity: row.quantity,
    unitPriceMinor: row.unitPriceMinor === null ? null : Number(row.unitPriceMinor),
    currency: row.currency,
    priority: row.priority,
    note: row.note,
    manyWelcome: row.manyWelcome,
    position: row.position,
    visibilityMode: row.visibilityMode,
    visibilityProfiles: row.ruleProfiles.map((p) => p.profileId),
    status: row.status,
    isSuggestion: row.isSuggestion,
    shownToRecipient: row.shownToRecipient,
    receivedAt: row.receivedAt,
    addedBy: row.addedByProfileId,
    intendedRecipientId: row.intendedRecipientId,
    createdAt: row.createdAt,
    version: row.version,
    carriedForward: row.carriedTo !== null,
    carryOrigin: row.carriedFrom
      ? {
          status: row.carriedFrom.status,
          event: row.carriedFrom.list.event
            ? {
                id: row.carriedFrom.list.event.id,
                title: row.carriedFrom.list.event.title,
                date: isoDay(row.carriedFrom.list.event.date),
              }
            : null,
        }
      : null,
  };
}

/** VIS-31 : traduction des critères du moteur en SQL. */
export function itemWhere(listId: string, criteria: ItemCriteria): Prisma.ListItemWhereInput {
  const viewer = criteria.ruleFor;
  return {
    listId,
    status: { not: 'WITHDRAWN' },
    ...(criteria.suggestions ? {} : { isSuggestion: false }),
    ...(criteria.shownOnly ? { shownToRecipient: true } : {}),
    OR: [
      { addedByProfileId: viewer },
      { visibilityMode: 'ALL' },
      { visibilityMode: 'ONLY', ruleProfiles: { some: { profileId: viewer } } },
      { visibilityMode: 'EXCEPT', ruleProfiles: { none: { profileId: viewer } } },
    ],
  };
}

function itemOrder(sort: ItemSort): Prisma.ListItemOrderByWithRelationInput[] {
  switch (sort) {
    case 'position':
      return [{ position: 'asc' }, { createdAt: 'asc' }];
    case 'priority':
      return [{ priority: 'desc' }, { position: 'asc' }];
    case 'price':
      return [{ unitPriceMinor: { sort: 'asc', nulls: 'last' } }, { position: 'asc' }];
    case 'added':
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}

@Injectable()
export class PrismaItemRepository extends ItemRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listItems(listId: string, criteria: ItemCriteria, sort: ItemSort): Promise<ItemRecord[]> {
    const rows = await this.prisma.listItem.findMany({
      where: itemWhere(listId, criteria),
      include: ITEM_INCLUDE,
      orderBy: itemOrder(sort),
      take: 1000,
    });
    return rows.map(toItem);
  }

  async find(itemId: string): Promise<ItemRecord | null> {
    const row = await this.prisma.listItem.findUnique({
      where: { id: itemId },
      include: ITEM_INCLUDE,
    });
    return row ? toItem(row) : null;
  }

  async create(item: NewItem): Promise<ItemRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      // LST-06 : en fin de liste ; le verrou de la liste sérialise les ajouts concurrents.
      await tx.$queryRaw`SELECT id FROM "list" WHERE id = ${item.listId}::uuid FOR UPDATE`;
      const last = await tx.listItem.aggregate({
        where: { listId: item.listId },
        _max: { position: true },
      });
      return tx.listItem.create({
        data: {
          id: item.id,
          listId: item.listId,
          productId: item.productId,
          addedByProfileId: item.addedBy,
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor === null ? null : BigInt(item.unitPriceMinor),
          currency: item.currency,
          priority: item.priority,
          note: item.note,
          manyWelcome: item.manyWelcome,
          position: (last._max.position ?? -1) + 1,
          visibilityMode: item.visibilityMode,
          isSuggestion: item.isSuggestion,
          intendedRecipientId: item.intendedRecipientId,
          shownToRecipient: item.shownToRecipient,
        },
        include: ITEM_INCLUDE,
      });
    });
    return toItem(row);
  }

  async carryCandidates(profileId: string, excludeEventId: string): Promise<CarryCandidate[]> {
    const rows = await this.prisma.listItem.findMany({
      where: {
        isSuggestion: false,
        status: { not: 'WITHDRAWN' },
        receivedAt: null,
        carriedTo: null,
        list: {
          type: 'WISHLIST',
          deletedAt: null,
          eventId: { not: excludeEventId },
          event: { isNot: null },
          recipients: { some: { profileId } },
        },
      },
      include: {
        ...ITEM_INCLUDE,
        list: {
          select: {
            id: true,
            event: { select: { id: true, title: true, date: true, timezone: true, status: true } },
          },
        },
      },
      orderBy: [{ listId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    return rows.flatMap((row) => {
      const event = row.list.event;
      if (!event) return [];
      return [
        {
          item: toItem(row),
          listId: row.list.id,
          event: {
            id: event.id,
            title: event.title,
            date: isoDay(event.date),
            timezone: event.timezone,
            closed: event.status !== 'UPCOMING',
          },
        },
      ];
    });
  }

  async carry(
    item: NewItem & {
      carriedFromItemId: string;
      ruleProfiles: readonly { id: string; profileId: string }[];
    },
  ): Promise<ItemRecord | 'already'> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "list" WHERE id = ${item.listId}::uuid FOR UPDATE`;
        const last = await tx.listItem.aggregate({
          where: { listId: item.listId },
          _max: { position: true },
        });
        await tx.listItem.create({
          data: {
            id: item.id,
            listId: item.listId,
            productId: item.productId,
            addedByProfileId: item.addedBy,
            quantity: item.quantity,
            unitPriceMinor: item.unitPriceMinor === null ? null : BigInt(item.unitPriceMinor),
            currency: item.currency,
            priority: item.priority,
            note: item.note,
            manyWelcome: item.manyWelcome,
            position: (last._max.position ?? -1) + 1,
            visibilityMode: item.visibilityMode,
            isSuggestion: false,
            intendedRecipientId: null,
            shownToRecipient: false,
            carriedFromItemId: item.carriedFromItemId,
          },
        });
        for (const rule of item.ruleProfiles) {
          await tx.itemVisibilityProfile.create({
            data: { id: rule.id, itemId: item.id, profileId: rule.profileId },
          });
        }
        return tx.listItem.findUniqueOrThrow({ where: { id: item.id }, include: ITEM_INCLUDE });
      });
      return toItem(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return 'already';
      }
      throw error;
    }
  }

  async update(input: {
    itemId: string;
    expectedVersion: number;
    changes: ItemChanges;
  }): Promise<ItemRecord | 'version' | 'missing'> {
    const { changes } = input;
    const result = await this.prisma.listItem.updateMany({
      where: { id: input.itemId, version: input.expectedVersion },
      data: {
        ...(changes.quantity !== undefined ? { quantity: changes.quantity } : {}),
        ...(changes.unitPriceMinor !== undefined
          ? {
              unitPriceMinor:
                changes.unitPriceMinor === null ? null : BigInt(changes.unitPriceMinor),
            }
          : {}),
        ...(changes.currency !== undefined ? { currency: changes.currency } : {}),
        ...(changes.priority !== undefined ? { priority: changes.priority } : {}),
        ...(changes.note !== undefined ? { note: changes.note } : {}),
        ...(changes.manyWelcome !== undefined ? { manyWelcome: changes.manyWelcome } : {}),
        ...(changes.position !== undefined ? { position: changes.position } : {}),
        ...(changes.intendedRecipientId !== undefined
          ? { intendedRecipientId: changes.intendedRecipientId }
          : {}),
        ...(changes.shownToRecipient !== undefined
          ? { shownToRecipient: changes.shownToRecipient }
          : {}),
        version: { increment: 1 },
      },
    });
    const row = await this.prisma.listItem.findUnique({
      where: { id: input.itemId },
      include: ITEM_INCLUDE,
    });
    if (!row) return 'missing';
    return result.count === 0 ? 'version' : toItem(row);
  }

  async delete(itemId: string): Promise<boolean> {
    const result = await this.prisma.listItem.deleteMany({ where: { id: itemId } });
    return result.count > 0;
  }

  async setRule(input: {
    itemId: string;
    expectedVersion: number;
    rule: RuleSnapshot;
    profileRowIds: readonly string[];
    log: RuleLogEntry | null;
  }): Promise<ItemRecord | 'version' | 'missing'> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.listItem.updateMany({
        where: { id: input.itemId, version: input.expectedVersion },
        data: { visibilityMode: input.rule.mode, version: { increment: 1 } },
      });
      if (result.count === 0) {
        return (await tx.listItem.count({ where: { id: input.itemId } })) ? 'version' : 'missing';
      }
      await tx.itemVisibilityProfile.deleteMany({ where: { itemId: input.itemId } });
      await tx.itemVisibilityProfile.createMany({
        data: input.rule.profiles.map((profileId, index) => ({
          id: input.profileRowIds[index] ?? '',
          itemId: input.itemId,
          profileId,
        })),
      });
      if (input.log) await tx.visibilityChangeLog.create({ data: logData(input.log) });
      return toItem(
        await tx.listItem.findUniqueOrThrow({ where: { id: input.itemId }, include: ITEM_INCLUDE }),
      );
    });
  }

  async productsOfList(listId: string): Promise<{ itemId: string; productId: string }[]> {
    const rows = await this.prisma.listItem.findMany({
      where: { listId },
      select: { id: true, productId: true },
    });
    return rows.map((row) => ({ itemId: row.id, productId: row.productId }));
  }

  async repointProduct(itemId: string, productId: string): Promise<void> {
    await this.prisma.listItem.update({ where: { id: itemId }, data: { productId } });
  }

  async referencesOf(productIds: readonly string[]): Promise<ItemProductReference[]> {
    if (productIds.length === 0) return [];
    const rows = await this.prisma.listItem.findMany({
      where: { productId: { in: [...productIds] }, status: { not: 'WITHDRAWN' } },
      select: {
        id: true,
        productId: true,
        version: true,
        visibilityMode: true,
        ruleProfiles: { select: { profileId: true } },
        list: { select: { recipients: { select: { profileId: true } } } },
      },
    });
    return rows.map((row) => ({
      productId: row.productId,
      itemId: row.id,
      version: row.version,
      rule: { mode: row.visibilityMode, profiles: row.ruleProfiles.map((p) => p.profileId) },
      listRecipients: row.list.recipients.map((r) => r.profileId),
    }));
  }
  async setReceived(itemId: string, at: Date | null): Promise<ItemRecord | null> {
    const result = await this.prisma.listItem.updateMany({
      where: { id: itemId, status: { not: 'WITHDRAWN' } },
      data: { receivedAt: at, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.find(itemId);
  }

  async withdraw(itemId: string, reason: WithdrawnReason): Promise<ItemRecord | null> {
    const result = await this.prisma.listItem.updateMany({
      where: { id: itemId, status: { not: 'WITHDRAWN' } },
      data: { status: 'WITHDRAWN', withdrawnReason: reason, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.find(itemId);
  }
}

function snapshot(value: Prisma.JsonValue): RuleSnapshot {
  const raw = (value ?? {}) as { mode?: RuleSnapshot['mode']; profiles?: string[] };
  return { mode: raw.mode ?? 'ALL', profiles: raw.profiles ?? [] };
}

@Injectable()
export class PrismaVisibilityLogRepository extends VisibilityLogRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listFor(listId: string, limit: number): Promise<RuleLogEntry[]> {
    const rows = await this.prisma.visibilityChangeLog.findMany({
      where: { listId },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      listId: row.listId,
      itemId: row.itemId,
      changedBy: row.changedBy,
      before: snapshot(row.before),
      after: snapshot(row.after),
      at: row.at,
    }));
  }
}

/** VIS-16 : aucun engagement avant la compta (phase 5). */
@Injectable()
export class NoEngagementReader extends EngagementReader {
  engagedProfiles(): Promise<string[]> {
    return Promise.resolve([]);
  }
}
