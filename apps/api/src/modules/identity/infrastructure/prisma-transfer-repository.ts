import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { MAX_PROFILES_PER_ACCOUNT } from '../domain/profile';
import type { SessionRef } from '../domain/ports';
import type { TransferPinChoice, TransferSubject } from '../domain/transfer';
import {
  type CompletedTransfer,
  type IncomingTransfer,
  type TransferPreview,
  TransferRepository,
  type TransferState,
} from '../domain/transfer.ports';
import { guardianGap } from './prisma-profile-repository';

type Tx = Prisma.TransactionClient;

const STATE = {
  id: true,
  kind: true,
  profileId: true,
  fromAccountId: true,
  toAccountId: true,
  newEmail: true,
  profileConsentRequired: true,
  regroup: true,
  fromAcceptedAt: true,
  toAcceptedAt: true,
  profileAcceptedAt: true,
  pinChoice: true,
  executesAt: true,
  expiresAt: true,
} as const satisfies Prisma.ProfileTransferSelect;

type StateRow = Prisma.ProfileTransferGetPayload<{ select: typeof STATE }>;

function toState(row: StateRow): TransferState | null {
  if (!row.profileId || (row.kind !== 'MOVE' && row.kind !== 'DETACH')) return null;
  return { ...row, kind: row.kind, profileId: row.profileId };
}

/** Demande ouverte : ni exécutée ni annulée, et pas expirée tant qu'il manque un accord. */
function openWhere(now: Date): Prisma.ProfileTransferWhereInput {
  return {
    completedAt: null,
    cancelledAt: null,
    OR: [{ executesAt: { not: null } }, { expiresAt: { gt: now } }],
  };
}

/**
 * PRO-12 : échéance posée au dernier accord (48 heures après), relue après l'écriture de l'accord
 * dans la même transaction (la ligne est déjà verrouillée par cette écriture).
 */
async function refreshExecution(tx: Tx, transferId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE "profile_transfer" SET "executes_at" = CASE
      WHEN "to_accepted_at" IS NOT NULL
        AND (NOT "profile_consent_required" OR "profile_accepted_at" IS NOT NULL)
      THEN GREATEST("from_accepted_at", "to_accepted_at",
                    COALESCE("profile_accepted_at", "from_accepted_at")) + interval '48 hours'
      ELSE NULL END
    WHERE "id" = ${transferId}::uuid`;
}

/** SQL de `canReceive`, utilisé hors et dans la transaction d'exécution. */
async function receivable(db: Tx | PrismaService, profileId: string, toAccountId: string) {
  const [row] = await db.$queryRaw<[{ ok: boolean }]>`
    SELECT (
      EXISTS (
        SELECT 1 FROM "account" t
        WHERE t."id" = ${toAccountId}::uuid AND t."status" = 'ACTIVE'
          AND t."guardian_account_id" IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM "profile" m WHERE m."id" = ${profileId}::uuid
          AND m."account_id" = ${toAccountId}::uuid)
      AND EXISTS (
        SELECT 1 FROM "profile_link" l
        JOIN "profile" p ON p."id" = CASE WHEN l."profile_a_id" = ${profileId}::uuid
          THEN l."profile_b_id" ELSE l."profile_a_id" END
        WHERE l."status" = 'ACCEPTED'
          AND (l."profile_a_id" = ${profileId}::uuid OR l."profile_b_id" = ${profileId}::uuid)
          AND p."account_id" = ${toAccountId}::uuid)
      AND NOT EXISTS (
        SELECT 1 FROM "profile_block" b JOIN "profile" p ON p."account_id" = ${toAccountId}::uuid
        WHERE (b."blocker_id" = p."id" AND b."blocked_id" = ${profileId}::uuid)
           OR (b."blocker_id" = ${profileId}::uuid AND b."blocked_id" = p."id"))
    ) AS ok`;
  return row.ok;
}

/** Annule l'exécution : une condition ne tient plus. */
class ExecutionFailed extends Error {}
class EmailTaken extends Error {}

/** Demandes de changement de compte en PostgreSQL (PRO-12 à PRO-14, LNK-11). */
@Injectable()
export class PrismaTransferRepository extends TransferRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async subject(
    profileId: string,
  ): Promise<
    (TransferSubject & { readonly accountId: string; readonly email: string | null }) | null
  > {
    const row = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: {
        accountId: true,
        isChild: true,
        childChangedAt: true,
        pinHash: true,
        pinResetAt: true,
        email: true,
        emailVerifiedAt: true,
      },
    });
    if (!row) return null;
    return {
      accountId: row.accountId,
      isChild: row.isChild,
      childChangedAt: row.childChangedAt,
      hasPin: row.pinHash !== null,
      pinResetAt: row.pinResetAt,
      emailVerifiedAt: row.emailVerifiedAt,
      email: row.emailVerifiedAt ? row.email : null,
    };
  }

  async create(input: {
    readonly id: string;
    readonly kind: 'MOVE' | 'DETACH';
    readonly profileId: string;
    readonly fromAccountId: string;
    readonly newEmail: string | null;
    readonly tokenHash: string;
    readonly tokenExpiresAt: Date;
    readonly expiresAt: Date;
    readonly profileConsentRequired: boolean;
    readonly regroup: boolean;
    readonly pinChoice: TransferPinChoice;
    readonly newPinHash: string | null;
    readonly now: Date;
  }): Promise<'created' | 'pending' | 'missing'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const owned = await tx.profile.count({
          where: { id: input.profileId, accountId: input.fromAccountId },
        });
        if (owned === 0) return 'missing' as const;
        // Une demande expirée sans tous ses accords est close d'abord : l'index n'en garde
        // qu'une ouverte par profil.
        await tx.profileTransfer.updateMany({
          where: {
            profileId: input.profileId,
            completedAt: null,
            cancelledAt: null,
            executesAt: null,
            expiresAt: { lte: input.now },
          },
          data: { cancelledAt: input.now },
        });
        await tx.profileTransfer.create({
          data: {
            id: input.id,
            kind: input.kind,
            profileId: input.profileId,
            fromAccountId: input.fromAccountId,
            newEmail: input.newEmail,
            tokenHash: input.tokenHash,
            tokenExpiresAt: input.tokenExpiresAt,
            profileConsentRequired: input.profileConsentRequired,
            regroup: input.regroup,
            fromAcceptedAt: input.now,
            // PRO-13 : l'accord du nouveau compte est son installation, après le délai.
            toAcceptedAt: input.kind === 'DETACH' ? input.now : null,
            pinChoice: input.pinChoice,
            newPinHash: input.newPinHash,
            expiresAt: input.expiresAt,
            createdAt: input.now,
          },
        });
        await refreshExecution(tx, input.id);
        return 'created' as const;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return 'pending';
      }
      throw error;
    }
  }

  async findOpenByProfile(profileId: string, now: Date): Promise<TransferState | null> {
    const row = await this.prisma.profileTransfer.findFirst({
      where: { profileId, ...openWhere(now) },
      select: STATE,
    });
    return row ? toState(row) : null;
  }

  async findOpenByToken(
    tokenHash: string,
    kind: 'MOVE' | 'DETACH',
    now: Date,
  ): Promise<TransferState | null> {
    const row = await this.prisma.profileTransfer.findFirst({
      where: { tokenHash, kind, tokenExpiresAt: { gt: now }, ...openWhere(now) },
      select: STATE,
    });
    return row ? toState(row) : null;
  }

  async canReceive(profileId: string, toAccountId: string): Promise<boolean> {
    return receivable(this.prisma, profileId, toAccountId);
  }

  async preview(transferId: string): Promise<TransferPreview | null> {
    const row = await this.prisma.profileTransfer.findUnique({
      where: { id: transferId },
      select: {
        profile: { select: { displayName: true, avatar: true, accentColor: true, isChild: true } },
      },
    });
    if (!row?.profile) return null;
    return {
      transferId,
      profileName: row.profile.displayName,
      avatar: row.profile.avatar,
      accentColor: row.profile.accentColor,
      isChild: row.profile.isChild,
    };
  }

  async acceptDestination(input: {
    readonly transferId: string;
    readonly toAccountId: string;
    readonly now: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.profileTransfer.updateMany({
        where: {
          id: input.transferId,
          kind: 'MOVE',
          toAcceptedAt: null,
          fromAccountId: { not: input.toAccountId },
          ...openWhere(input.now),
        },
        data: { toAccountId: input.toAccountId, toAcceptedAt: input.now },
      });
      if (count === 0) return false;
      await refreshExecution(tx, input.transferId);
      return true;
    });
  }

  async withdrawDestination(transferId: string, toAccountId: string): Promise<boolean> {
    const { count } = await this.prisma.profileTransfer.updateMany({
      where: { id: transferId, kind: 'MOVE', toAccountId, completedAt: null, cancelledAt: null },
      data: { toAccountId: null, toAcceptedAt: null, executesAt: null },
    });
    return count > 0;
  }

  async consentProfile(input: {
    readonly transferId: string;
    readonly pinChoice: TransferPinChoice;
    readonly newPinHash: string | null;
    readonly now: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.profileTransfer.updateMany({
        where: {
          id: input.transferId,
          profileConsentRequired: true,
          profileAcceptedAt: null,
          ...openWhere(input.now),
        },
        data: {
          profileAcceptedAt: input.now,
          pinChoice: input.pinChoice,
          newPinHash: input.newPinHash,
        },
      });
      if (count === 0) return false;
      await refreshExecution(tx, input.transferId);
      return true;
    });
  }

  async cancel(transferId: string, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Mêmes verrous que l'exécution : une annulation ne croise pas une exécution (PRO-14).
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "profile_transfer"
        WHERE "id" = ${transferId}::uuid AND "completed_at" IS NULL AND "cancelled_at" IS NULL
        FOR UPDATE`;
      if (!row) return false;
      await tx.profileTransfer.update({
        where: { id: transferId },
        data: { cancelledAt: now, newPinHash: null },
      });
      await tx.accountToken.updateMany({
        where: { transferId, usedAt: null },
        data: { usedAt: now },
      });
      return true;
    });
  }

  async listIncoming(toAccountId: string, now: Date): Promise<IncomingTransfer[]> {
    const rows = await this.prisma.profileTransfer.findMany({
      where: { toAccountId, kind: 'MOVE', ...openWhere(now) },
      select: {
        id: true,
        executesAt: true,
        profile: { select: { displayName: true, accentColor: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.flatMap((row) =>
      row.profile
        ? [
            {
              id: row.id,
              profileName: row.profile.displayName,
              accentColor: row.profile.accentColor,
              executesAt: row.executesAt,
            },
          ]
        : [],
    );
  }

  async due(now: Date): Promise<{ readonly id: string; readonly kind: 'MOVE' | 'DETACH' }[]> {
    const rows = await this.prisma.profileTransfer.findMany({
      where: {
        kind: { in: ['MOVE', 'DETACH'] },
        completedAt: null,
        cancelledAt: null,
        executesAt: { lte: now },
      },
      select: { id: true, kind: true },
      take: 100,
    });
    return rows.flatMap((row) =>
      row.kind === 'MOVE' || row.kind === 'DETACH' ? [{ id: row.id, kind: row.kind }] : [],
    );
  }

  async issueSetupToken(input: {
    readonly transferId: string;
    readonly tokenHash: string;
    readonly tokenExpiresAt: Date;
    readonly now: Date;
  }): Promise<boolean> {
    // `expires_at` suit : le lien ne survit jamais à la demande (`CHECK`).
    const changed = await this.prisma.$executeRaw`
      UPDATE "profile_transfer" SET "token_hash" = ${input.tokenHash},
        "token_expires_at" = ${input.tokenExpiresAt},
        "expires_at" = GREATEST("expires_at", ${input.tokenExpiresAt}), "updated_at" = ${input.now}
      WHERE "id" = ${input.transferId}::uuid AND "kind" = 'DETACH' AND "completed_at" IS NULL
        AND "cancelled_at" IS NULL AND "executes_at" <= ${input.now}`;
    return changed === 1;
  }

  async setupSent(transferId: string): Promise<boolean> {
    const row = await this.prisma.profileTransfer.findUnique({
      where: { id: transferId },
      select: { tokenExpiresAt: true, executesAt: true },
    });
    return Boolean(row?.executesAt && row.tokenExpiresAt > row.executesAt);
  }

  async execute(input: {
    readonly transferId: string;
    readonly now: Date;
    readonly linkIds: () => string;
    readonly newAccount?: {
      readonly id: string;
      readonly email: string;
      readonly passwordHash: string;
    };
  }): Promise<CompletedTransfer | { readonly status: 'failed' | 'not_due' | 'email_taken' }> {
    try {
      return await this.prisma.$transaction(async (tx) => this.executeIn(tx, input), {
        timeout: 15_000,
      });
    } catch (error) {
      if (error instanceof EmailTaken) return { status: 'email_taken' };
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        input.newAccount
      ) {
        return { status: 'email_taken' };
      }
      if (!(error instanceof ExecutionFailed)) throw error;
      // PRO-12 : un échec à l'exécution se montre comme un retrait d'acceptation du compte
      // d'arrivée, pour qu'un blocage ne se devine pas (LNK-05).
      await this.prisma.profileTransfer.updateMany({
        where: { id: input.transferId, kind: 'MOVE', completedAt: null, cancelledAt: null },
        data: { toAccountId: null, toAcceptedAt: null, executesAt: null },
      });
      return { status: 'failed' };
    }
  }

  private async executeIn(
    tx: Tx,
    input: {
      readonly transferId: string;
      readonly now: Date;
      readonly linkIds: () => string;
      readonly newAccount?: {
        readonly id: string;
        readonly email: string;
        readonly passwordHash: string;
      };
    },
  ): Promise<CompletedTransfer | { readonly status: 'not_due' }> {
    const [transfer] = await tx.$queryRaw<
      {
        id: string;
        kind: string;
        profile_id: string | null;
        from_account_id: string;
        to_account_id: string | null;
        new_email: string | null;
        regroup: boolean;
        profile_consent_required: boolean;
        profile_accepted_at: Date | null;
        pin_choice: TransferPinChoice;
        new_pin_hash: string | null;
      }[]
    >`
      SELECT "id", "kind"::text AS kind, "profile_id", "from_account_id", "to_account_id",
             "new_email", "regroup", "profile_consent_required", "profile_accepted_at",
             "pin_choice"::text AS pin_choice, "new_pin_hash"
      FROM "profile_transfer"
      WHERE "id" = ${input.transferId}::uuid AND "completed_at" IS NULL
        AND "cancelled_at" IS NULL AND "executes_at" <= ${input.now}
      FOR UPDATE`;
    if (!transfer?.profile_id) return { status: 'not_due' };
    const profileId = transfer.profile_id;
    const fromAccountId = transfer.from_account_id;
    if (transfer.profile_consent_required && !transfer.profile_accepted_at) {
      throw new ExecutionFailed();
    }

    // PRO-13 : le nouveau compte naît dans la transaction, vérifié, avec la déclaration d'âge.
    let toAccountId = transfer.to_account_id;
    if (transfer.kind === 'DETACH') {
      if (!input.newAccount || transfer.new_email !== input.newAccount.email) {
        throw new ExecutionFailed();
      }
      const reserved = await tx.accountToken.count({
        where: {
          purpose: 'EMAIL_CHANGE_CANCEL',
          newEmail: input.newAccount.email,
          usedAt: null,
          expiresAt: { gt: input.now },
        },
      });
      if (reserved > 0) throw new EmailTaken();
      await tx.account.create({
        data: {
          id: input.newAccount.id,
          email: input.newAccount.email,
          emailVerifiedAt: input.now,
          passwordHash: input.newAccount.passwordHash,
          ageAttestedAt: input.now,
          createdAt: input.now,
        },
      });
      toAccountId = input.newAccount.id;
    }
    if (!toAccountId) throw new ExecutionFailed();

    // Verrous des deux comptes, dans l'ordre de leurs identifiants (PRO-14).
    const [first, second] = [fromAccountId, toAccountId].sort();
    await tx.$queryRaw`SELECT "id" FROM "account" WHERE "id" = ${first}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "account" WHERE "id" = ${second}::uuid FOR UPDATE`;

    const profile = await tx.profile.findFirst({
      where: { id: profileId, accountId: fromAccountId },
      select: { id: true, isChild: true, email: true, emailVerifiedAt: true },
    });
    if (!profile) throw new ExecutionFailed();
    const [from] = await tx.$queryRaw<{ guardian_account_id: string | null; status: string }[]>`
      SELECT "guardian_account_id", "status"::text AS status FROM "account"
      WHERE "id" = ${fromAccountId}::uuid`;
    // PRO-15 : un compte sous tutelle ne change pas de profil par cette voie (le tuteur).
    if (!from || from.guardian_account_id !== null) throw new ExecutionFailed();

    if (transfer.kind === 'MOVE' && !(await receivable(tx, profileId, toAccountId))) {
      throw new ExecutionFailed();
    }
    if (
      (await tx.profile.count({ where: { accountId: toAccountId } })) >= MAX_PROFILES_PER_ACCOUNT
    ) {
      throw new ExecutionFailed();
    }
    const remaining = await tx.profile.findMany({
      where: { accountId: fromAccountId, id: { not: profileId } },
      select: { id: true, isChild: true },
    });
    if (remaining.length === 0) {
      // PRO-12 : regroupement déclaré seulement, jamais d'un compte tuteur.
      if (!transfer.regroup || transfer.kind !== 'MOVE') throw new ExecutionFailed();
      if ((await tx.account.count({ where: { guardianAccountId: fromAccountId } })) > 0) {
        throw new ExecutionFailed();
      }
    }
    const gapBefore = await guardianGap(tx, fromAccountId);

    // Sessions du compte d'origine où le profil est actif : désélectionnées en base avant le
    // changement (déclencheur `profile_account_matches_sessions`) ; le cache suit après.
    const sessions = await tx.$queryRaw<{ id: string; token_hash: string }[]>`
      UPDATE "session" SET "active_profile_id" = NULL, "reauth_at" = NULL
      WHERE "active_profile_id" = ${profileId}::uuid
      RETURNING "id", "token_hash"`;

    // LNK-11 : liens devenus internes au compte d'arrivée supprimés.
    const internal = await tx.$queryRaw<{ other: string }[]>`
      DELETE FROM "profile_link" l
      USING "profile" p
      WHERE (l."profile_a_id" = ${profileId}::uuid OR l."profile_b_id" = ${profileId}::uuid)
        AND p."id" = CASE WHEN l."profile_a_id" = ${profileId}::uuid
          THEN l."profile_b_id" ELSE l."profile_a_id" END
        AND p."account_id" = ${toAccountId}::uuid
      RETURNING p."id" AS other`;

    const pinHash =
      transfer.pin_choice === 'NEW'
        ? transfer.new_pin_hash
        : transfer.pin_choice === 'NONE'
          ? null
          : undefined;
    if (transfer.pin_choice === 'NEW' && !pinHash) throw new ExecutionFailed();
    await tx.profile.update({
      where: { id: profileId },
      data: {
        accountId: toAccountId,
        ...(pinHash !== undefined ? { pinHash } : {}),
        pinFailedCount: 0,
        pinLockedUntil: null,
        version: { increment: 1 },
      },
    });

    // LNK-11 : la famille quittée reste dans le cercle, sauf blocage.
    const created: string[] = [];
    for (const other of remaining) {
      const blocked = await tx.profileBlock.count({
        where: {
          OR: [
            { blockerId: profileId, blockedId: other.id },
            { blockerId: other.id, blockedId: profileId },
          ],
        },
      });
      if (blocked > 0) continue;
      const [a, b] = profileId < other.id ? [profileId, other.id] : [other.id, profileId];
      const aIsChild = a === profileId ? profile.isChild : other.isChild;
      const bIsChild = b === profileId ? profile.isChild : other.isChild;
      await tx.profileLink.create({
        data: {
          id: input.linkIds(),
          profileAId: a,
          profileBId: b,
          status: 'ACCEPTED',
          origin: 'TRANSFER',
          requestedBy: profileId,
          aGuardianRequired: aIsChild,
          bGuardianRequired: bIsChild,
          createdAt: input.now,
        },
      });
      created.push(other.id);
    }

    // PRO-14 : invitations `PROFILE` ouvertes du profil révoquées.
    await tx.invitation.updateMany({
      where: { createdBy: profileId, kind: 'PROFILE', revokedAt: null },
      data: { revokedAt: input.now },
    });
    await tx.accountToken.updateMany({
      where: { transferId: transfer.id, usedAt: null },
      data: { usedAt: input.now },
    });
    await tx.profileTransfer.update({
      where: { id: transfer.id },
      data: { completedAt: input.now, toAccountId, newPinHash: null },
    });

    // PRO-12 : pas de compte laissé sans adulte (hors regroupement, où il n'y a plus de profil).
    if (remaining.length > 0 && !gapBefore && (await guardianGap(tx, fromAccountId))) {
      throw new ExecutionFailed();
    }

    const toProfiles = await tx.profile.findMany({
      where: { accountId: toAccountId, id: { not: profileId } },
      select: { id: true },
    });
    const deselected: SessionRef[] = sessions.map((s) => ({
      id: s.id,
      accountId: fromAccountId,
      tokenHash: s.token_hash,
    }));
    return {
      status: 'completed',
      profileId,
      fromAccountId,
      toAccountId,
      deselected,
      circleChanged: [
        ...new Set([
          profileId,
          ...remaining.map((r) => r.id),
          ...toProfiles.map((p) => p.id),
          ...internal.map((i) => i.other),
          ...created,
        ]),
      ],
      fromEmptied: remaining.length === 0,
      profileEmail: profile.emailVerifiedAt ? profile.email : null,
    };
  }

  async linkedNamesIn(profileId: string, accountId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ display_name: string }[]>`
      SELECT p."display_name" FROM "profile_link" l
      JOIN "profile" p ON p."id" = CASE WHEN l."profile_a_id" = ${profileId}::uuid
        THEN l."profile_b_id" ELSE l."profile_a_id" END
      WHERE l."status" = 'ACCEPTED'
        AND (l."profile_a_id" = ${profileId}::uuid OR l."profile_b_id" = ${profileId}::uuid)
        AND p."account_id" = ${accountId}::uuid
      ORDER BY p."display_name"`;
    return rows.map((row) => row.display_name);
  }

  async issueMailToken(input: {
    readonly id: string;
    readonly accountId: string;
    readonly profileId: string;
    readonly transferId: string;
    readonly purpose: 'TRANSFER_CONSENT' | 'TRANSFER_CANCEL';
    readonly tokenHash: string;
    readonly now: Date;
    readonly expiresAt: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.accountToken.updateMany({
        where: { transferId: input.transferId, purpose: input.purpose, usedAt: null },
        data: { usedAt: input.now },
      });
      await tx.accountToken.create({
        data: {
          id: input.id,
          accountId: input.accountId,
          profileId: input.profileId,
          transferId: input.transferId,
          purpose: input.purpose,
          tokenHash: input.tokenHash,
          createdAt: input.now,
          expiresAt: input.expiresAt,
        },
      });
    });
  }

  async findMailToken(
    tokenHash: string,
    purpose: 'TRANSFER_CONSENT' | 'TRANSFER_CANCEL',
    now: Date,
  ): Promise<{ readonly transferId: string; readonly profileId: string } | null> {
    const row = await this.prisma.accountToken.findFirst({
      where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: now } },
      select: { transferId: true, profileId: true },
    });
    return row?.transferId && row.profileId
      ? { transferId: row.transferId, profileId: row.profileId }
      : null;
  }

  async consumeMailToken(
    tokenHash: string,
    purpose: 'TRANSFER_CONSENT' | 'TRANSFER_CANCEL',
    now: Date,
  ): Promise<boolean> {
    const { count } = await this.prisma.accountToken.updateMany({
      where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    return count === 1;
  }

  async suspendEmptyAccount(accountId: string, authEpoch: number): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "account" SET "auth_epoch" = GREATEST("auth_epoch", ${authEpoch})
        WHERE "id" = ${accountId}::uuid`;
      const suspended = await tx.$executeRaw`
        UPDATE "account" SET "status" = 'SUSPENDED', "updated_at" = now()
        WHERE "id" = ${accountId}::uuid
          AND NOT EXISTS (SELECT 1 FROM "profile" WHERE "account_id" = ${accountId}::uuid)`;
      return suspended === 1;
    });
  }

  async deleteEmptyAccount(accountId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "account" WHERE "id" = ${accountId}::uuid AND "status" = 'SUSPENDED'
          AND NOT EXISTS (SELECT 1 FROM "profile" WHERE "account_id" = ${accountId}::uuid)
        FOR UPDATE`;
      if (rows.length === 0) return false;
      // Jetons, identités, codes de secours, appareils, demandes : en cascade. Sessions : déjà
      // révoquées par le changement d'époque (RESTRICT sinon).
      await tx.account.delete({ where: { id: accountId } });
      return true;
    });
  }
}
