import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import {
  type BlockedRow,
  type CircleMember,
  type InvitationLookup,
  type LinkParty,
  type LinkPartyDetails,
  type LinkRecord,
  type LinkSide,
  type OpenInvitation,
  orderPair,
  planLink,
  type ProfileInvitationLookup,
  type ProfileProposal,
} from '../domain/link';
import type { NewProfile } from '../domain/account';
import { MAX_PROFILES_PER_ACCOUNT } from '../domain/profile';
import { LinkRepository, type RedeemOutcome } from '../domain/link.ports';

const PARTY = {
  id: true,
  accountId: true,
  isChild: true,
  displayName: true,
  accentColor: true,
  avatar: true,
} as const;

const LINK_WITH_PARTIES = {
  profileA: { select: PARTY },
  profileB: { select: PARTY },
} as const;

type PartyRow = Prisma.ProfileGetPayload<{ select: typeof PARTY }>;
type LinkRow = Prisma.ProfileLinkGetPayload<{ include: typeof LINK_WITH_PARTIES }>;
type Tx = Prisma.TransactionClient;

interface InvitationRow {
  id: string;
  expires_at: Date;
  created_at: Date;
  profile_id: string;
  account_id: string;
  is_child: boolean;
  display_name: string;
  accent_color: string;
  avatar: string | null;
}

function toParty(row: PartyRow): LinkPartyDetails {
  return {
    id: row.id,
    accountId: row.accountId,
    isChild: row.isChild,
    displayName: row.displayName,
    accentColor: row.accentColor,
    avatar: row.avatar,
  };
}

function toRecord(row: LinkRow): LinkRecord {
  return {
    id: row.id,
    status: row.status,
    origin: row.origin,
    requestedBy: row.requestedBy,
    a: toParty(row.profileA),
    b: toParty(row.profileB),
    aGuardianRequired: row.aGuardianRequired,
    bGuardianRequired: row.bGuardianRequired,
    aGuardianApprovedBy: row.aGuardianApprovedBy,
    bGuardianApprovedBy: row.bGuardianApprovedBy,
    createdAt: row.createdAt,
  };
}

function toInviter(row: InvitationRow): LinkPartyDetails {
  return {
    id: row.profile_id,
    accountId: row.account_id,
    isChild: row.is_child,
    displayName: row.display_name,
    accentColor: row.accent_color,
    avatar: row.avatar,
  };
}

/**
 * Verrou partagé sur les profils d'une paire : un changement du marqueur enfant (`setChild`, verrou
 * exclusif de la ligne) attend la fin de l'ouverture, ou la précède ; `planLink` lit toujours le
 * marqueur à jour.
 */
async function lockProfiles(tx: Tx, ids: readonly string[]): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "profile" WHERE "id" = ANY(${ids}::uuid[]) ORDER BY "id" FOR SHARE`;
}

type Db = Tx | PrismaService;

/**
 * PRO-11 : un profil du compte `accountId` est lié (`ACCEPTED`) à l'invitant, sans blocage dans un
 * sens ou l'autre. Revérifié à l'acceptation de la proposition et à sa consommation.
 */
async function inviterLinkedTo(db: Db, inviterId: string, accountId: string): Promise<boolean> {
  const [row] = await db.$queryRaw<[{ linked: boolean }]>`
    SELECT EXISTS (
      SELECT 1 FROM "profile_link" l
      JOIN "profile" p ON p."id" = CASE WHEN l."profile_a_id" = ${inviterId}::uuid
        THEN l."profile_b_id" ELSE l."profile_a_id" END
      WHERE l."status" = 'ACCEPTED'
        AND (l."profile_a_id" = ${inviterId}::uuid OR l."profile_b_id" = ${inviterId}::uuid)
        AND p."account_id" = ${accountId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM "profile_block" b
          WHERE (b."blocker_id" = p."id" AND b."blocked_id" = ${inviterId}::uuid)
             OR (b."blocker_id" = ${inviterId}::uuid AND b."blocked_id" = p."id"))
    ) AS linked`;
  return row.linked;
}

/**
 * Revérification en base de `isGuardianOf` (LNK-06, PRO-15), pour `g` le tuteur et `c` l'enfant :
 * même compte, ou compte tuteur de celui de l'enfant avec un lien de tutelle entre eux.
 */
const GUARDIAN_OF_CHILD = Prisma.sql`(
  g."account_id" = c."account_id"
  OR EXISTS (
    SELECT 1 FROM "account" ca
    JOIN "profile_link" gl ON gl."origin" = 'GUARDIANSHIP'
      AND gl."profile_a_id" = LEAST(g."id", c."id") AND gl."profile_b_id" = GREATEST(g."id", c."id")
    WHERE ca."id" = c."account_id" AND ca."guardian_account_id" = g."account_id"))`;

/**
 * PRO-15 : tuteurs de chaque enfant d'un compte sous tutelle parmi `childIds` : les profils non
 * enfants du compte tuteur reliés à lui par un lien `GUARDIANSHIP`. Les autres profils n'ont pas
 * d'entrée (aucun tuteur hors de leur compte).
 */
async function wardGuardiansOf(
  db: Db,
  childIds: readonly string[],
): Promise<Map<string, string[]>> {
  const guardians = new Map<string, string[]>();
  if (childIds.length === 0) return guardians;
  const rows = await db.$queryRaw<{ child_id: string; guardian_id: string }[]>`
    SELECT c."id" AS child_id, g."id" AS guardian_id
    FROM "profile" c
    JOIN "account" ca ON ca."id" = c."account_id" AND ca."guardian_account_id" IS NOT NULL
    JOIN "profile_link" l ON l."origin" = 'GUARDIANSHIP'
      AND (l."profile_a_id" = c."id" OR l."profile_b_id" = c."id")
    JOIN "profile" g ON g."id" = CASE WHEN l."profile_a_id" = c."id"
      THEN l."profile_b_id" ELSE l."profile_a_id" END
    WHERE c."id" = ANY(${[...childIds]}::uuid[]) AND c."is_child"
      AND g."account_id" = ca."guardian_account_id" AND NOT g."is_child"`;
  for (const row of rows) {
    guardians.set(row.child_id, [...(guardians.get(row.child_id) ?? []), row.guardian_id]);
  }
  return guardians;
}

function withGuardians(
  party: LinkPartyDetails,
  guardians: Map<string, string[]>,
): LinkPartyDetails {
  const ids = guardians.get(party.id);
  return ids ? { ...party, wardGuardianIds: ids } : party;
}

/** Complète les parties enfants des liens par leurs tuteurs de compte sous tutelle (PRO-15). */
async function completeRecords(db: Db, records: LinkRecord[]): Promise<LinkRecord[]> {
  const children = records
    .flatMap((r) => [r.a, r.b])
    .filter((p) => p.isChild)
    .map((p) => p.id);
  const guardians = await wardGuardiansOf(db, [...new Set(children)]);
  if (guardians.size === 0) return records;
  return records.map((r) => ({
    ...r,
    a: withGuardians(r.a, guardians),
    b: withGuardians(r.b, guardians),
  }));
}

/** Verrou consultatif de la paire : ouverture, rupture et blocage concurrents se sérialisent. */
async function lockPair(tx: Tx, x: string, y: string): Promise<void> {
  const [a, b] = x < y ? [x, y] : [y, x];
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`link:${a}:${b}`}, 0))`;
}

/**
 * Liens, blocages et invitations en base (LNK-01 à LNK-10). Les règles sont dans `domain/link` ;
 * ici, seulement les écritures conditionnelles et les verrous qui les rendent atomiques.
 */
@Injectable()
export class PrismaLinkRepository extends LinkRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findParty(profileId: string): Promise<LinkPartyDetails | null> {
    const row = await this.prisma.profile.findUnique({ where: { id: profileId }, select: PARTY });
    if (!row) return null;
    const party = toParty(row);
    return party.isChild
      ? withGuardians(party, await wardGuardiansOf(this.prisma, [party.id]))
      : party;
  }

  async circleOf(profileId: string): Promise<CircleMember[]> {
    const me = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: { accountId: true },
    });
    if (!me) return [];
    const [siblings, links, blocks] = await Promise.all([
      this.prisma.profile.findMany({
        where: { accountId: me.accountId, id: { not: profileId } },
        select: PARTY,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.profileLink.findMany({
        where: {
          status: 'ACCEPTED',
          OR: [{ profileAId: profileId }, { profileBId: profileId }],
        },
        include: LINK_WITH_PARTIES,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.profileBlock.findMany({
        where: { OR: [{ blockerId: profileId }, { blockedId: profileId }] },
        select: { blockerId: true, blockedId: true },
      }),
    ]);
    const blocked = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]));
    const members: CircleMember[] = [];
    const seen = new Set<string>([profileId]);
    const add = (party: PartyRow, source: CircleMember['source']): void => {
      if (seen.has(party.id) || blocked.has(party.id)) return;
      seen.add(party.id);
      members.push({
        profileId: party.id,
        displayName: party.displayName,
        avatar: party.avatar,
        accentColor: party.accentColor,
        source,
      });
    };
    for (const sibling of siblings) add(sibling, 'ACCOUNT');
    for (const link of links)
      add(link.profileAId === profileId ? link.profileB : link.profileA, 'LINK');
    return members;
  }

  async membersOf(profileId: string): Promise<string[]> {
    return (await this.circleOf(profileId)).map((member) => member.profileId);
  }

  async inCircle(profileId: string, otherProfileId: string): Promise<boolean> {
    return (await this.membersOf(profileId)).includes(otherProfileId);
  }

  async isBlockedEitherWay(profileId: string, otherProfileId: string): Promise<boolean> {
    const count = await this.prisma.profileBlock.count({
      where: {
        OR: [
          { blockerId: profileId, blockedId: otherProfileId },
          { blockerId: otherProfileId, blockedId: profileId },
        ],
      },
    });
    return count > 0;
  }

  async createInvitation(input: {
    readonly id: string;
    readonly tokenHash: string;
    readonly createdBy: string;
    readonly now: Date;
    readonly expiresAt: Date;
    readonly maxOpen: number;
    readonly profile?: {
      readonly targetAccountId: string;
      readonly profileIsChild: boolean;
      readonly accepted: boolean;
    };
  }): Promise<'created' | 'limit'> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`invitations:${input.createdBy}`}, 0))`;
      const [{ open }] = await tx.$queryRaw<[{ open: number }]>`
        SELECT count(*)::int AS open FROM "invitation"
        WHERE "created_by" = ${input.createdBy}::uuid AND "kind" IN ('LINK', 'PROFILE')
          AND "revoked_at" IS NULL AND "expires_at" > ${input.now}
          AND "used_count" < "max_uses"`;
      if (open >= input.maxOpen) return 'limit' as const;
      await tx.invitation.create({
        data: {
          id: input.id,
          kind: input.profile ? 'PROFILE' : 'LINK',
          targetId: input.profile?.targetAccountId ?? input.createdBy,
          profileIsChild: input.profile?.profileIsChild ?? null,
          targetAcceptedAt: input.profile?.accepted ? input.now : null,
          tokenHash: input.tokenHash,
          createdBy: input.createdBy,
          maxUses: 1,
          createdAt: input.now,
          expiresAt: input.expiresAt,
        },
      });
      return 'created' as const;
    });
  }

  async listOpenInvitations(profileId: string, now: Date): Promise<OpenInvitation[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        kind: 'LINK' | 'PROFILE';
        target_accepted_at: Date | null;
        target_refused_at: Date | null;
        created_at: Date;
        expires_at: Date;
      }[]
    >`
      SELECT "id", "kind"::text AS kind, "target_accepted_at", "target_refused_at", "created_at",
             "expires_at"
      FROM "invitation"
      WHERE "created_by" = ${profileId}::uuid AND "kind" IN ('LINK', 'PROFILE')
        AND "expires_at" > ${now} AND "used_count" < "max_uses"
        AND ("revoked_at" IS NULL OR "target_refused_at" IS NOT NULL)
      ORDER BY "created_at" DESC`;
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      proposal:
        row.kind === 'LINK'
          ? null
          : row.target_refused_at
            ? ('REFUSED' as const)
            : row.target_accepted_at
              ? ('ACCEPTED' as const)
              : ('PENDING' as const),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));
  }

  async revokeInvitation(profileId: string, invitationId: string, now: Date): Promise<boolean> {
    const { count } = await this.prisma.invitation.updateMany({
      where: {
        id: invitationId,
        createdBy: profileId,
        kind: { in: ['LINK', 'PROFILE'] },
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });
    return count > 0;
  }

  async findOpenInvitation(tokenHash: string, now: Date): Promise<InvitationLookup | null> {
    const rows = await this.prisma.$queryRaw<InvitationRow[]>`
      SELECT i."id", i."expires_at", i."created_at", p."id" AS profile_id, p."account_id",
             p."is_child", p."display_name", p."accent_color", p."avatar"
      FROM "invitation" i JOIN "profile" p ON p."id" = i."created_by"
      WHERE i."token_hash" = ${tokenHash} AND i."kind" = 'LINK' AND i."revoked_at" IS NULL
        AND i."expires_at" > ${now} AND i."used_count" < i."max_uses"`;
    const row = rows[0];
    return row ? { id: row.id, inviter: toInviter(row), expiresAt: row.expires_at } : null;
  }

  async redeemInvitation(input: {
    readonly tokenHash: string;
    readonly redeemerId: string;
    readonly linkId: string;
    readonly now: Date;
  }): Promise<RedeemOutcome> {
    const found = await this.findOpenInvitation(input.tokenHash, input.now);
    if (!found) return { kind: 'invalid' };
    return this.prisma.$transaction(async (tx): Promise<RedeemOutcome> => {
      const redeemer = await tx.profile.findUnique({
        where: { id: input.redeemerId },
        select: PARTY,
      });
      if (!redeemer) return { kind: 'invalid' };
      if (redeemer.id === found.inviter.id || redeemer.accountId === found.inviter.accountId) {
        return { kind: 'same_account' };
      }
      await lockPair(tx, redeemer.id, found.inviter.id);
      await lockProfiles(tx, [redeemer.id, found.inviter.id]);
      // L'invitant peut avoir changé de statut enfant depuis la lecture : relu sous verrou.
      const inviter = await tx.profile.findUnique({
        where: { id: found.inviter.id },
        select: PARTY,
      });
      if (!inviter) return { kind: 'invalid' };
      // Idem pour celui qui ouvre : le marqueur enfant lu avant le verrou peut être périmé (PRO-05).
      const locked = await tx.profile.findUnique({ where: { id: redeemer.id }, select: PARTY });
      if (!locked) return { kind: 'invalid' };
      const blocked = await tx.profileBlock.count({
        where: {
          OR: [
            { blockerId: redeemer.id, blockedId: inviter.id },
            { blockerId: inviter.id, blockedId: redeemer.id },
          ],
        },
      });
      if (blocked > 0) return { kind: 'invalid' };
      const [a, b] = orderPair(toParty(inviter), toParty(locked));
      const existing = await tx.profileLink.findUnique({
        where: { profileAId_profileBId: { profileAId: a.id, profileBId: b.id } },
        select: { id: true },
      });
      if (existing) return { kind: 'already_linked' };
      const consumed = await tx.$executeRaw`
        UPDATE "invitation" SET "used_count" = "used_count" + 1, "updated_at" = ${input.now}
        WHERE "id" = ${found.id}::uuid AND "used_count" < "max_uses"
          AND "revoked_at" IS NULL AND "expires_at" > ${input.now}`;
      if (consumed !== 1) return { kind: 'invalid' };
      const plan = planLink(a, b);
      await tx.profileLink.create({
        data: {
          id: input.linkId,
          profileAId: a.id,
          profileBId: b.id,
          status: plan.status,
          requestedBy: inviter.id,
          aGuardianRequired: plan.aGuardianRequired,
          bGuardianRequired: plan.bGuardianRequired,
          createdAt: input.now,
        },
      });
      return { kind: 'linked', linkId: input.linkId, status: plan.status };
    });
  }

  async consumePendingInvitation(input: {
    readonly accountId: string;
    readonly linkId: string;
    readonly now: Date;
  }): Promise<'none' | 'linked' | 'exhausted'> {
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.account.findUnique({
        where: { id: input.accountId },
        select: { pendingInvitationId: true, status: true },
      });
      if (!account?.pendingInvitationId) return 'none' as const;
      if (account.status !== 'ACTIVE') return 'exhausted' as const;
      const rows = await tx.$queryRaw<InvitationRow[]>`
        SELECT i."id", i."expires_at", i."created_at", p."id" AS profile_id, p."account_id",
               p."is_child", p."display_name", p."accent_color", p."avatar"
        FROM "invitation" i JOIN "profile" p ON p."id" = i."created_by"
        WHERE i."id" = ${account.pendingInvitationId}::uuid AND i."kind" = 'LINK'
          AND i."revoked_at" IS NULL AND i."expires_at" > ${input.now}
          AND i."used_count" < i."max_uses"`;
      const invitation = rows[0];
      const first = await tx.profile.findFirst({
        where: { accountId: input.accountId },
        orderBy: { createdAt: 'asc' },
        select: PARTY,
      });
      if (!invitation || !first || invitation.account_id === input.accountId) {
        return 'exhausted' as const;
      }
      await lockPair(tx, first.id, invitation.profile_id);
      await lockProfiles(tx, [first.id, invitation.profile_id]);
      const inviter = await tx.profile.findUnique({
        where: { id: invitation.profile_id },
        select: PARTY,
      });
      if (!inviter) return 'exhausted' as const;
      const lockedFirst = await tx.profile.findUnique({ where: { id: first.id }, select: PARTY });
      if (!lockedFirst) return 'exhausted' as const;
      const blocked = await tx.profileBlock.count({
        where: {
          OR: [
            { blockerId: first.id, blockedId: inviter.id },
            { blockerId: inviter.id, blockedId: first.id },
          ],
        },
      });
      if (blocked > 0) return 'exhausted' as const;
      const consumed = await tx.$executeRaw`
        UPDATE "invitation" SET "used_count" = "used_count" + 1, "updated_at" = ${input.now}
        WHERE "id" = ${invitation.id}::uuid AND "used_count" < "max_uses"
          AND "revoked_at" IS NULL AND "expires_at" > ${input.now}`;
      if (consumed !== 1) return 'exhausted' as const;
      const [a, b] = orderPair(toParty(inviter), toParty(lockedFirst));
      const plan = planLink(a, b);
      await tx.profileLink.create({
        data: {
          id: input.linkId,
          profileAId: a.id,
          profileBId: b.id,
          status: plan.status,
          requestedBy: inviter.id,
          aGuardianRequired: plan.aGuardianRequired,
          bGuardianRequired: plan.bGuardianRequired,
          createdAt: input.now,
        },
      });
      // Le lien prouve la boîte seulement par la vérification qui a amené ici : même transaction.
      await tx.account.update({
        where: { id: input.accountId },
        data: { pendingInvitationId: null },
      });
      await tx.account.updateMany({
        where: { id: input.accountId, emailVerifiedAt: null },
        data: { emailVerifiedAt: input.now },
      });
      return 'linked' as const;
    });
  }

  async listLinks(actor: LinkParty): Promise<LinkRecord[]> {
    // PRO-15 : enfants de comptes sous tutelle que l'acteur garde par un lien de tutelle.
    const wards = actor.isChild
      ? []
      : (
          await this.prisma.$queryRaw<{ id: string }[]>`
            SELECT c."id" FROM "profile_link" l
            JOIN "profile" c ON c."id" = CASE WHEN l."profile_a_id" = ${actor.id}::uuid
              THEN l."profile_b_id" ELSE l."profile_a_id" END
            JOIN "account" ca ON ca."id" = c."account_id"
            WHERE l."origin" = 'GUARDIANSHIP'
              AND (l."profile_a_id" = ${actor.id}::uuid OR l."profile_b_id" = ${actor.id}::uuid)
              AND c."is_child" AND ca."guardian_account_id" = ${actor.accountId}::uuid`
        ).map((row) => row.id);
    const guarded = actor.isChild
      ? []
      : [
          { profileA: { accountId: actor.accountId, isChild: true } },
          { profileB: { accountId: actor.accountId, isChild: true } },
          { profileAId: { in: wards } },
          { profileBId: { in: wards } },
        ];
    const rows = await this.prisma.profileLink.findMany({
      where: { OR: [{ profileAId: actor.id }, { profileBId: actor.id }, ...guarded] },
      include: LINK_WITH_PARTIES,
      orderBy: { createdAt: 'desc' },
    });
    return completeRecords(this.prisma, rows.map(toRecord));
  }

  async findLink(linkId: string): Promise<LinkRecord | null> {
    const row = await this.prisma.profileLink.findUnique({
      where: { id: linkId },
      include: LINK_WITH_PARTIES,
    });
    if (!row) return null;
    const [record] = await completeRecords(this.prisma, [toRecord(row)]);
    return record ?? null;
  }

  async approveSide(input: {
    readonly linkId: string;
    readonly side: LinkSide;
    readonly guardianId: string;
    readonly now: Date;
  }): Promise<LinkRecord | null> {
    // Une seule écriture : le côté est validé, et le lien passe à ACCEPTED si l'autre côté
    // requis l'est déjà (la contrainte `profile_link_accepted_is_approved` le garantit).
    const changed =
      input.side === 'A'
        ? await this.prisma.$executeRaw`
            UPDATE "profile_link" SET
              "a_guardian_approved_by" = ${input.guardianId}::uuid,
              "status" = CASE WHEN (NOT "b_guardian_required" OR "b_guardian_approved_by" IS NOT NULL)
                         THEN 'ACCEPTED'::"link_status" ELSE "status" END,
              "updated_at" = ${input.now}
            WHERE "id" = ${input.linkId}::uuid AND "status" = 'AWAITING_GUARDIAN'
              AND "a_guardian_required" AND "a_guardian_approved_by" IS NULL
              AND EXISTS (
                SELECT 1 FROM "profile" g, "profile" c
                WHERE g."id" = ${input.guardianId}::uuid AND c."id" = "profile_a_id"
                  AND NOT g."is_child" AND c."is_child" AND ${GUARDIAN_OF_CHILD})`
        : await this.prisma.$executeRaw`
            UPDATE "profile_link" SET
              "b_guardian_approved_by" = ${input.guardianId}::uuid,
              "status" = CASE WHEN (NOT "a_guardian_required" OR "a_guardian_approved_by" IS NOT NULL)
                         THEN 'ACCEPTED'::"link_status" ELSE "status" END,
              "updated_at" = ${input.now}
            WHERE "id" = ${input.linkId}::uuid AND "status" = 'AWAITING_GUARDIAN'
              AND "b_guardian_required" AND "b_guardian_approved_by" IS NULL
              AND EXISTS (
                SELECT 1 FROM "profile" g, "profile" c
                WHERE g."id" = ${input.guardianId}::uuid AND c."id" = "profile_b_id"
                  AND NOT g."is_child" AND c."is_child" AND ${GUARDIAN_OF_CHILD})`;
    return changed === 1 ? this.findLink(input.linkId) : null;
  }

  async deleteLink(linkId: string): Promise<LinkRecord | null | 'guardian_required'> {
    const link = await this.findLink(linkId);
    if (!link) return null;
    return this.prisma.$transaction(async (tx) => {
      await lockPair(tx, link.a.id, link.b.id);
      if (link.origin === 'GUARDIANSHIP') {
        // PRO-15 : jamais le dernier lien de tutelle d'un enfant. Le compte de l'enfant est
        // verrouillé : deux ruptures concurrentes de ses liens de tutelle se sérialisent.
        const child = link.a.isChild ? link.a : link.b;
        await tx.$queryRaw`SELECT "id" FROM "account" WHERE "id" = ${child.accountId}::uuid FOR UPDATE`;
        const others = await tx.profileLink.count({
          where: {
            origin: 'GUARDIANSHIP',
            id: { not: linkId },
            OR: [{ profileAId: child.id }, { profileBId: child.id }],
          },
        });
        if (others === 0) return 'guardian_required' as const;
      }
      const { count } = await tx.profileLink.deleteMany({ where: { id: linkId } });
      return count > 0 ? link : null;
    });
  }

  async block(input: {
    readonly id: string;
    readonly blockerId: string;
    readonly blockedId: string;
    readonly now: Date;
  }): Promise<'blocked' | 'not_linked'> {
    return this.prisma.$transaction(async (tx) => {
      await lockPair(tx, input.blockerId, input.blockedId);
      const [a, b] =
        input.blockerId < input.blockedId
          ? [input.blockerId, input.blockedId]
          : [input.blockedId, input.blockerId];
      // PRO-15 : un lien de tutelle ne se bloque pas ; il est traité comme absent (`404`).
      const { count } = await tx.profileLink.deleteMany({
        where: { profileAId: a, profileBId: b, origin: { not: 'GUARDIANSHIP' } },
      });
      if (count === 0) return 'not_linked' as const;
      await tx.profileBlock.createMany({
        data: [
          {
            id: input.id,
            blockerId: input.blockerId,
            blockedId: input.blockedId,
            createdAt: input.now,
          },
        ],
        skipDuplicates: true,
      });
      return 'blocked' as const;
    });
  }

  async unblock(blockerId: string, blockedId: string): Promise<boolean> {
    const { count } = await this.prisma.profileBlock.deleteMany({
      where: { blockerId, blockedId },
    });
    return count > 0;
  }

  async listBlocks(blockerId: string): Promise<BlockedRow[]> {
    const rows = await this.prisma.profileBlock.findMany({
      where: { blockerId },
      include: { blocked: { select: PARTY } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      profileId: row.blocked.id,
      displayName: row.blocked.displayName,
      accentColor: row.blocked.accentColor,
      isChild: row.blocked.isChild,
    }));
  }

  async listProfileProposals(accountId: string, now: Date): Promise<ProfileProposal[]> {
    const rows = await this.prisma.$queryRaw<
      { id: string; display_name: string; profile_is_child: boolean; expires_at: Date }[]
    >`
      SELECT i."id", p."display_name", i."profile_is_child", i."expires_at"
      FROM "invitation" i JOIN "profile" p ON p."id" = i."created_by"
      WHERE i."kind" = 'PROFILE' AND i."target_id" = ${accountId}::uuid
        AND p."account_id" <> ${accountId}::uuid AND NOT p."is_child"
        AND NOT EXISTS (
          SELECT 1 FROM "profile_block" b JOIN "profile" t ON t."account_id" = ${accountId}::uuid
          WHERE (b."blocker_id" = t."id" AND b."blocked_id" = p."id")
             OR (b."blocker_id" = p."id" AND b."blocked_id" = t."id"))
        AND i."target_accepted_at" IS NULL AND i."target_refused_at" IS NULL
        AND i."revoked_at" IS NULL AND i."expires_at" > ${now} AND i."used_count" < i."max_uses"
      ORDER BY i."created_at" DESC`;
    return rows.map((row) => ({
      id: row.id,
      inviterName: row.display_name,
      profileIsChild: row.profile_is_child,
      expiresAt: row.expires_at,
    }));
  }

  async decideProfileProposal(input: {
    readonly invitationId: string;
    readonly accountId: string;
    readonly accept: boolean;
    readonly now: Date;
  }): Promise<'accepted' | 'refused' | 'revoked' | 'missing'> {
    return this.prisma.$transaction(async (tx) => {
      const [invitation] = await tx.$queryRaw<{ created_by: string }[]>`
        SELECT i."created_by" FROM "invitation" i JOIN "profile" p ON p."id" = i."created_by"
        WHERE i."id" = ${input.invitationId}::uuid AND i."kind" = 'PROFILE'
          AND i."target_id" = ${input.accountId}::uuid AND p."account_id" <> ${input.accountId}::uuid
          AND i."target_accepted_at" IS NULL AND i."target_refused_at" IS NULL
          AND i."revoked_at" IS NULL AND i."expires_at" > ${input.now}
          AND i."used_count" < i."max_uses"
        FOR UPDATE OF i`;
      if (!invitation) return 'missing' as const;
      const stillLinked =
        input.accept && (await inviterLinkedTo(tx, invitation.created_by, input.accountId));
      if (!stillLinked) {
        // Refus, ou lien et absence de blocage perdus : même état vu de l'invitant (LNK-05).
        await tx.invitation.update({
          where: { id: input.invitationId },
          data: { revokedAt: input.now, targetRefusedAt: input.now },
        });
        return input.accept ? ('revoked' as const) : ('refused' as const);
      }
      await tx.invitation.update({
        where: { id: input.invitationId },
        data: { targetAcceptedAt: input.now },
      });
      return 'accepted' as const;
    });
  }

  async findProfileInvitation(
    tokenHash: string,
    now: Date,
  ): Promise<ProfileInvitationLookup | null> {
    const rows = await this.prisma.$queryRaw<
      (InvitationRow & {
        target_id: string;
        profile_is_child: boolean;
        target_accepted_at: Date | null;
      })[]
    >`
      SELECT i."id", i."expires_at", i."created_at", i."target_id", i."profile_is_child",
             i."target_accepted_at", p."id" AS profile_id, p."account_id", p."is_child",
             p."display_name", p."accent_color", p."avatar"
      FROM "invitation" i JOIN "profile" p ON p."id" = i."created_by"
      WHERE i."token_hash" = ${tokenHash} AND i."kind" = 'PROFILE' AND i."revoked_at" IS NULL
        AND i."expires_at" > ${now} AND i."used_count" < i."max_uses"`;
    const row = rows[0];
    return row
      ? {
          id: row.id,
          inviter: toInviter(row),
          targetAccountId: row.target_id,
          profileIsChild: row.profile_is_child,
          accepted: row.target_accepted_at !== null,
          expiresAt: row.expires_at,
        }
      : null;
  }

  async redeemProfileInvitation(input: {
    readonly tokenHash: string;
    readonly profile: NewProfile;
    readonly pinHash: string | null;
    readonly linkId: string;
    readonly now: Date;
  }): Promise<
    | {
        readonly status: 'created';
        readonly targetAccountId: string;
        readonly inviterId: string;
        readonly inviterAccountId: string;
        readonly isChild: boolean;
      }
    | { readonly status: 'invalid' | 'pending' | 'limit' }
  > {
    return this.prisma.$transaction(async (tx) => {
      // Invitation verrouillée : deux ouvertures simultanées n'en servent qu'une.
      const [invitation] = await tx.$queryRaw<
        {
          id: string;
          created_by: string;
          target_id: string;
          profile_is_child: boolean;
          target_accepted_at: Date | null;
        }[]
      >`
        SELECT "id", "created_by", "target_id", "profile_is_child", "target_accepted_at"
        FROM "invitation"
        WHERE "token_hash" = ${input.tokenHash} AND "kind" = 'PROFILE' AND "revoked_at" IS NULL
          AND "expires_at" > ${input.now} AND "used_count" < "max_uses"
        FOR UPDATE`;
      if (!invitation) return { status: 'invalid' as const };
      if (!invitation.target_accepted_at) return { status: 'pending' as const };
      const inviter = await tx.profile.findUnique({
        where: { id: invitation.created_by },
        select: { id: true, accountId: true, isChild: true },
      });
      // PRO-11 : l'invitant est resté adulte ; le compte visé n'est pas sous tutelle.
      if (!inviter || inviter.isChild) return { status: 'invalid' as const };
      const [target] = await tx.$queryRaw<{ guardian_account_id: string | null }[]>`
        SELECT "guardian_account_id" FROM "account"
        WHERE "id" = ${invitation.target_id}::uuid AND "status" = 'ACTIVE' FOR UPDATE`;
      if (!target || target.guardian_account_id !== null) return { status: 'invalid' as const };
      const otherAccount = inviter.accountId !== invitation.target_id;
      if (otherAccount && !(await inviterLinkedTo(tx, inviter.id, invitation.target_id))) {
        // Revue SEC-40 (M5) : révoquée, vue comme un refus par l'invitant (LNK-05).
        await tx.invitation.update({
          where: { id: invitation.id },
          // Une décision à la fois (`invitation_target_decided_once`) : l'acceptation tombe.
          data: { revokedAt: input.now, targetAcceptedAt: null, targetRefusedAt: input.now },
        });
        return { status: 'invalid' as const };
      }
      const count = await tx.profile.count({ where: { accountId: invitation.target_id } });
      if (count >= MAX_PROFILES_PER_ACCOUNT) return { status: 'limit' as const };
      await tx.profile.create({
        data: {
          ...input.profile,
          accountId: invitation.target_id,
          isChild: invitation.profile_is_child,
          // PRO-11 : un profil créé enfant garde son propre accord 30 jours (PRO-12).
          childChangedAt: invitation.profile_is_child ? input.now : null,
          pinHash: input.pinHash,
          createdAt: input.now,
        },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { usedCount: { increment: 1 } },
      });
      if (otherAccount) {
        const [a, b] =
          inviter.id < input.profile.id
            ? [inviter.id, input.profile.id]
            : [input.profile.id, inviter.id];
        // PRO-11 : lien accepté d'office ; un côté enfant est réputé validé par l'accord du compte
        // qui le porte (LNK-06), d'où l'exigence de validation à faux.
        await tx.profileLink.create({
          data: {
            id: input.linkId,
            profileAId: a,
            profileBId: b,
            status: 'ACCEPTED',
            requestedBy: inviter.id,
            aGuardianRequired: false,
            bGuardianRequired: false,
            createdAt: input.now,
          },
        });
      }
      return {
        status: 'created' as const,
        targetAccountId: invitation.target_id,
        inviterId: inviter.id,
        inviterAccountId: inviter.accountId,
        isChild: invitation.profile_is_child,
      };
    });
  }

  async purgeInvitations(before: Date): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM "invitation"
      WHERE "expires_at" < ${before} OR "revoked_at" < ${before}
         OR ("used_count" >= "max_uses" AND "updated_at" < ${before})`;
  }
}
