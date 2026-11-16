import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import type { EventRole, Rsvp } from '../../visibility';
import type { EventChanges, EventRecord, PersonCard } from '../domain/event';
import {
  type EventLinkRecord,
  EventLinkRepository,
  EventPeople,
  EventRepository,
  type NewEvent,
  type ProfileSettings,
} from '../domain/event.ports';

const EVENT_INCLUDE = {
  participants: {
    select: { profileId: true, role: true, isHonoree: true, rsvp: true, respondedAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.EventInclude;

type EventRow = Prisma.EventGetPayload<{ include: typeof EVENT_INCLUDE }>;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function toEvent(row: EventRow): EventRecord {
  return {
    id: row.id,
    title: row.title,
    date: isoDay(row.date),
    timezone: row.timezone,
    place: row.place,
    description: row.description,
    type: row.type,
    mode: row.mode,
    isSurprise: row.isSurprise,
    suggestedBudgetMinor:
      row.suggestedBudgetMinor === null ? null : Number(row.suggestedBudgetMinor),
    currency: row.currency,
    status: row.status,
    createdBy: row.createdBy,
    recreatedFromId: row.recreatedFromId,
    participants: row.participants,
    createdAt: row.createdAt,
    version: row.version,
  };
}

/** Violation d'un déclencheur de l'ADR 0017 (`23514` relevé par PostgreSQL). */
function isCheckViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2010' || /23514|check/i.test(error.message);
  }
  return error instanceof Prisma.PrismaClientUnknownRequestError && /23514/.test(error.message);
}

@Injectable()
export class PrismaEventRepository extends EventRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(event: NewEvent): Promise<EventRecord | 'conflict'> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await tx.event.create({
          data: {
            id: event.id,
            title: event.title,
            date: dayDate(event.date),
            timezone: event.timezone,
            place: event.place,
            description: event.description,
            type: event.type,
            mode: event.mode,
            isSurprise: event.isSurprise,
            suggestedBudgetMinor:
              event.suggestedBudgetMinor === null ? null : BigInt(event.suggestedBudgetMinor),
            currency: event.currency,
            createdBy: event.createdBy,
            recreatedFromId: event.recreatedFromId,
            createdAt: event.now,
          },
        });
        for (const participant of event.participants) {
          await tx.eventParticipant.create({
            data: {
              id: participant.id,
              eventId: event.id,
              profileId: participant.profileId,
              role: participant.role,
              isHonoree: participant.isHonoree,
              rsvp: participant.rsvp,
              respondedAt: participant.rsvp === 'PENDING' ? null : event.now,
              invitedBy: participant.invitedBy,
            },
          });
        }
        for (const recipient of event.surpriseRecipients) {
          await tx.eventSurpriseRecipient.create({
            data: { id: recipient.id, eventId: event.id, profileId: recipient.profileId },
          });
        }
        return tx.event.findUniqueOrThrow({ where: { id: event.id }, include: EVENT_INCLUDE });
      });
      return toEvent(row);
    } catch (error) {
      if (isCheckViolation(error)) return 'conflict';
      throw error;
    }
  }

  async find(eventId: string): Promise<EventRecord | null> {
    const row = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: EVENT_INCLUDE,
    });
    return row ? toEvent(row) : null;
  }

  async findForProfile(profileId: string): Promise<EventRecord[]> {
    // EVT-08, ADR 0017 : on part des lignes de participant ; la table des honorés d'une surprise
    // n'est jamais lue ici.
    const rows = await this.prisma.event.findMany({
      where: { participants: { some: { profileId } } },
      include: EVENT_INCLUDE,
    });
    return rows.map(toEvent);
  }

  async update(input: {
    eventId: string;
    expectedVersion: number;
    changes: EventChanges;
  }): Promise<EventRecord | 'version' | 'missing'> {
    const { changes } = input;
    const { count } = await this.prisma.event.updateMany({
      where: { id: input.eventId, version: input.expectedVersion },
      data: {
        ...(changes.title !== undefined ? { title: changes.title } : {}),
        ...(changes.date !== undefined ? { date: dayDate(changes.date) } : {}),
        ...(changes.place !== undefined ? { place: changes.place } : {}),
        ...(changes.description !== undefined ? { description: changes.description } : {}),
        ...(changes.type !== undefined ? { type: changes.type } : {}),
        ...(changes.suggestedBudgetMinor !== undefined
          ? {
              suggestedBudgetMinor:
                changes.suggestedBudgetMinor === null ? null : BigInt(changes.suggestedBudgetMinor),
            }
          : {}),
        version: { increment: 1 },
      },
    });
    const row = await this.find(input.eventId);
    if (!row) return 'missing';
    return count === 1 ? row : 'version';
  }

  async cancel(eventId: string, at: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.event.updateMany({
        where: { id: eventId, status: 'UPCOMING' },
        data: { status: 'CANCELLED', cancelledAt: at, version: { increment: 1 } },
      }),
      this.prisma.invitation.updateMany({
        where: { kind: 'EVENT', targetId: eventId, revokedAt: null },
        data: { revokedAt: at },
      }),
    ]);
  }

  async delete(eventId: string, at: Date): Promise<void> {
    await this.prisma.$transaction([
      // EVT-29 : l'audience `EVENT` d'une liste détachée devient `MEMBERS` (jamais d'élargissement).
      this.prisma.list.updateMany({
        where: { eventId, audience: 'EVENT' },
        data: { audience: 'MEMBERS', version: { increment: 1 } },
      }),
      this.prisma.list.updateMany({
        where: { eventId },
        data: { eventId: null },
      }),
      this.prisma.invitation.updateMany({
        where: { kind: 'EVENT', targetId: eventId, revokedAt: null },
        data: { revokedAt: at },
      }),
      this.prisma.event.delete({ where: { id: eventId } }),
    ]);
  }

  async addParticipants(input: {
    eventId: string;
    invitedBy: string;
    rows: readonly { id: string; profileId: string }[];
  }): Promise<{ readonly added: readonly string[] } | 'surprise_honoree'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = new Set(
          (
            await tx.eventParticipant.findMany({
              where: {
                eventId: input.eventId,
                profileId: { in: input.rows.map((r) => r.profileId) },
              },
              select: { profileId: true },
            })
          ).map((row) => row.profileId),
        );
        const added: string[] = [];
        for (const row of input.rows) {
          if (existing.has(row.profileId)) continue;
          await tx.eventParticipant.create({
            data: {
              id: row.id,
              eventId: input.eventId,
              profileId: row.profileId,
              invitedBy: input.invitedBy,
            },
          });
          added.push(row.profileId);
        }
        return { added };
      });
    } catch (error) {
      if (isCheckViolation(error)) return 'surprise_honoree';
      throw error;
    }
  }

  async removeParticipant(eventId: string, profileId: string): Promise<boolean> {
    const { count } = await this.prisma.eventParticipant.deleteMany({
      where: { eventId, profileId },
    });
    return count > 0;
  }

  async setRole(eventId: string, profileId: string, role: EventRole): Promise<boolean> {
    const { count } = await this.prisma.eventParticipant.updateMany({
      where: { eventId, profileId },
      data: { role },
    });
    return count > 0;
  }

  async setRsvp(eventId: string, profileId: string, rsvp: Rsvp, at: Date): Promise<boolean> {
    const { count } = await this.prisma.eventParticipant.updateMany({
      where: { eventId, profileId },
      data: { rsvp, respondedAt: at },
    });
    return count > 0;
  }

  async addHonorees(input: {
    eventId: string;
    surprise: boolean;
    invitedBy: string;
    rows: readonly { id: string; profileId: string }[];
  }): Promise<'ok' | 'conflict'> {
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const row of input.rows) {
          if (input.surprise) {
            await tx.eventSurpriseRecipient.upsert({
              where: { eventId_profileId: { eventId: input.eventId, profileId: row.profileId } },
              create: { id: row.id, eventId: input.eventId, profileId: row.profileId },
              update: {},
            });
          } else {
            await tx.eventParticipant.upsert({
              where: { eventId_profileId: { eventId: input.eventId, profileId: row.profileId } },
              create: {
                id: row.id,
                eventId: input.eventId,
                profileId: row.profileId,
                isHonoree: true,
                invitedBy: input.invitedBy,
              },
              update: { isHonoree: true },
            });
          }
        }
      });
      return 'ok';
    } catch (error) {
      if (isCheckViolation(error)) return 'conflict';
      throw error;
    }
  }

  async surpriseRecipients(eventId: string): Promise<string[]> {
    const rows = await this.prisma.eventSurpriseRecipient.findMany({
      where: { eventId },
      select: { profileId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => row.profileId);
  }

  async cards(profileIds: readonly string[]): Promise<PersonCard[]> {
    if (profileIds.length === 0) return [];
    return this.prisma.profile.findMany({
      where: { id: { in: [...profileIds] } },
      select: { id: true, displayName: true, avatar: true, accentColor: true },
    });
  }

  async upcomingBefore(day: string): Promise<EventRecord[]> {
    const rows = await this.prisma.event.findMany({
      where: { status: 'UPCOMING', date: { lt: dayDate(day) } },
      include: EVENT_INCLUDE,
      take: 500,
    });
    return rows.map(toEvent);
  }

  async markDone(eventId: string): Promise<void> {
    await this.prisma.event.updateMany({
      where: { id: eventId, status: 'UPCOMING' },
      data: { status: 'DONE', version: { increment: 1 } },
    });
  }
}

const LINK_SELECT = {
  id: true,
  targetId: true,
  createdBy: true,
  maxUses: true,
  usedCount: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.InvitationSelect;

function toLink(row: Prisma.InvitationGetPayload<{ select: typeof LINK_SELECT }>): EventLinkRecord {
  return {
    id: row.id,
    eventId: row.targetId,
    createdBy: row.createdBy,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/** EVT-16 : table `invitation`, type `EVENT` seulement (ADR 0017). */
@Injectable()
export class PrismaEventLinkRepository extends EventLinkRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(input: {
    id: string;
    eventId: string;
    createdBy: string;
    tokenHash: string;
    maxUses: number;
    expiresAt: Date;
  }): Promise<EventLinkRecord> {
    const row = await this.prisma.invitation.create({
      data: {
        id: input.id,
        kind: 'EVENT',
        targetId: input.eventId,
        tokenHash: input.tokenHash,
        createdBy: input.createdBy,
        maxUses: input.maxUses,
        expiresAt: input.expiresAt,
      },
      select: LINK_SELECT,
    });
    return toLink(row);
  }

  async listOpen(eventId: string, now: Date): Promise<EventLinkRecord[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        target_id: string;
        created_by: string;
        max_uses: number;
        used_count: number;
        expires_at: Date;
        created_at: Date;
      }[]
    >`
      SELECT "id", "target_id", "created_by", "max_uses", "used_count", "expires_at", "created_at"
      FROM "invitation"
      WHERE "kind" = 'EVENT' AND "target_id" = ${eventId}::uuid AND "revoked_at" IS NULL
        AND "expires_at" > ${now} AND "used_count" < "max_uses"
      ORDER BY "created_at" DESC`;
    return rows.map((row) => ({
      id: row.id,
      eventId: row.target_id,
      createdBy: row.created_by,
      maxUses: row.max_uses,
      usedCount: row.used_count,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }));
  }

  async revoke(eventId: string, linkId: string, now: Date): Promise<boolean> {
    const { count } = await this.prisma.invitation.updateMany({
      where: { id: linkId, kind: 'EVENT', targetId: eventId, revokedAt: null },
      data: { revokedAt: now },
    });
    return count > 0;
  }

  async findLive(tokenHash: string, now: Date): Promise<EventLinkRecord | null> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "invitation"
      WHERE "token_hash" = ${tokenHash} AND "kind" = 'EVENT' AND "revoked_at" IS NULL
        AND "expires_at" > ${now}`;
    const id = rows[0]?.id;
    if (!id) return null;
    const row = await this.prisma.invitation.findUnique({ where: { id }, select: LINK_SELECT });
    return row ? toLink(row) : null;
  }

  async redeem(input: {
    linkId: string;
    eventId: string;
    profileId: string;
    participantId: string;
    now: Date;
  }): Promise<'joined' | 'already' | 'invalid'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Même verrou que les déclencheurs de l'ADR 0017 : sérialise avec l'ajout d'un honoré.
        await tx.$queryRaw`SELECT 1 FROM "event" WHERE "id" = ${input.eventId}::uuid FOR NO KEY UPDATE`;
        const already = await tx.eventParticipant.findUnique({
          where: { eventId_profileId: { eventId: input.eventId, profileId: input.profileId } },
          select: { id: true },
        });
        if (already) return 'already' as const;
        const secret = await tx.eventSurpriseRecipient.findUnique({
          where: { eventId_profileId: { eventId: input.eventId, profileId: input.profileId } },
          select: { id: true },
        });
        if (secret) return 'invalid' as const;
        const consumed = await tx.$executeRaw`
          UPDATE "invitation" SET "used_count" = "used_count" + 1, "updated_at" = ${input.now}
          WHERE "id" = ${input.linkId}::uuid AND "kind" = 'EVENT' AND "used_count" < "max_uses"
            AND "revoked_at" IS NULL AND "expires_at" > ${input.now}`;
        if (consumed !== 1) return 'invalid' as const;
        await tx.eventParticipant.create({
          data: { id: input.participantId, eventId: input.eventId, profileId: input.profileId },
        });
        return 'joined' as const;
      });
    } catch (error) {
      if (isCheckViolation(error)) return 'invalid';
      throw error;
    }
  }
}

@Injectable()
export class PrismaEventPeople extends EventPeople {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async settings(profileId: string): Promise<ProfileSettings | null> {
    return this.prisma.profile.findUnique({
      where: { id: profileId },
      select: { timezone: true, currency: true, isChild: true },
    });
  }

  async blockedWithAny(profileId: string, others: readonly string[]): Promise<boolean> {
    if (others.length === 0) return false;
    const count = await this.prisma.profileBlock.count({
      where: {
        OR: [
          { blockerId: profileId, blockedId: { in: [...others] } },
          { blockedId: profileId, blockerId: { in: [...others] } },
        ],
      },
    });
    return count > 0;
  }
}
