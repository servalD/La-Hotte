import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import type { NewProfile } from '../domain/account';
import { MAX_PROFILES_PER_ACCOUNT, type ProfileMetadata } from '../domain/profile';
import type { Guardianship, OpenWardSetup, WardSummary } from '../domain/ward';
import { WardRepository } from '../domain/ward.ports';

type Tx = Prisma.TransactionClient;

const PROFILE_METADATA = {
  id: true,
  displayName: true,
  avatar: true,
  accentColor: true,
  pinHash: true,
  isChild: true,
  emailVerifiedAt: true,
} as const satisfies Prisma.ProfileSelect;

const WARD = {
  id: true,
  email: true,
  createdAt: true,
  guardianReleaseRequestedAt: true,
  profiles: { select: PROFILE_METADATA, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} as const satisfies Prisma.AccountSelect;

type WardRow = Prisma.AccountGetPayload<{ select: typeof WARD }>;

function toSummary(row: WardRow): WardSummary {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.createdAt,
    releaseRequested: row.guardianReleaseRequestedAt !== null,
    profiles: row.profiles.map(({ pinHash, emailVerifiedAt, ...profile }): ProfileMetadata => ({
      ...profile,
      hasPin: pinHash !== null,
      hasEmail: emailVerifiedAt !== null,
    })),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * LNK-11, PRO-15 : un profil qui naît dans un compte sous tutelle est lié d'office à chaque profil
 * du compte tuteur : par un lien de tutelle aux adultes, par un lien ordinaire aux enfants.
 * Renvoie le nombre d'adultes (0 : l'enfant n'aurait pas de tuteur).
 */
async function linkToGuardian(
  tx: Tx,
  wardProfileId: string,
  guardianAccountId: string,
  linkIds: () => string,
  now: Date,
): Promise<number> {
  // Verrou partagé : un adulte du tuteur ne devient pas enfant pendant la création des liens.
  const guardians = await tx.$queryRaw<{ id: string; is_child: boolean }[]>`
    SELECT "id", "is_child" FROM "profile" WHERE "account_id" = ${guardianAccountId}::uuid
    ORDER BY "id" FOR SHARE`;
  for (const guardian of guardians) {
    const [a, b] =
      guardian.id < wardProfileId ? [guardian.id, wardProfileId] : [wardProfileId, guardian.id];
    await tx.profileLink.create({
      data: {
        id: linkIds(),
        profileAId: a,
        profileBId: b,
        status: 'ACCEPTED',
        origin: guardian.is_child ? 'TRANSFER' : 'GUARDIANSHIP',
        requestedBy: guardian.id,
        // Côtés enfants réputés validés par l'accord du tuteur (LNK-11) : `origin` l'exempte.
        aGuardianRequired: a === wardProfileId || guardian.is_child,
        bGuardianRequired: b === wardProfileId || guardian.is_child,
        createdAt: now,
      },
    });
  }
  return guardians.filter((guardian) => !guardian.is_child).length;
}

/** Comptes sous tutelle en PostgreSQL (PRO-15, PRO-16). */
@Injectable()
export class PrismaWardRepository extends WardRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async guardianshipOf(accountId: string): Promise<Guardianship | null> {
    const row = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { guardian: { select: { id: true, email: true } } },
    });
    return row?.guardian
      ? { guardianAccountId: row.guardian.id, guardianEmail: row.guardian.email }
      : null;
  }

  async hasWards(accountId: string): Promise<boolean> {
    return (await this.prisma.account.count({ where: { guardianAccountId: accountId } })) > 0;
  }

  async createSetupRequest(input: {
    readonly id: string;
    readonly guardianAccountId: string;
    readonly email: string;
    readonly profileName: string;
    readonly tokenHash: string;
    readonly now: Date;
    readonly tokenExpiresAt: Date;
    readonly expiresAt: Date;
  }): Promise<void> {
    await this.prisma.profileTransfer.create({
      data: {
        id: input.id,
        kind: 'WARD',
        newProfileName: input.profileName,
        fromAccountId: input.guardianAccountId,
        newEmail: input.email,
        tokenHash: input.tokenHash,
        tokenExpiresAt: input.tokenExpiresAt,
        // PRO-15 : nouveau profil enfant, aucun accord de profil ; le tuteur donne celui des deux
        // comptes.
        profileConsentRequired: false,
        fromAcceptedAt: input.now,
        toAcceptedAt: input.now,
        pinChoice: 'NONE',
        expiresAt: input.expiresAt,
        createdAt: input.now,
      },
    });
  }

  async findOpenSetup(tokenHash: string, now: Date): Promise<OpenWardSetup | null> {
    const row = await this.prisma.profileTransfer.findFirst({
      where: {
        tokenHash,
        kind: 'WARD',
        profileId: null,
        completedAt: null,
        cancelledAt: null,
        tokenExpiresAt: { gt: now },
        expiresAt: { gt: now },
      },
      select: {
        id: true,
        fromAccountId: true,
        newEmail: true,
        newProfileName: true,
        fromAcceptedAt: true,
      },
    });
    if (!row?.newEmail || !row.newProfileName) return null;
    return {
      transferId: row.id,
      guardianAccountId: row.fromAccountId,
      email: row.newEmail,
      profileName: row.newProfileName,
      guardianAttestedAt: row.fromAcceptedAt,
    };
  }

  async completeSetup(input: {
    readonly tokenHash: string;
    readonly accountId: string;
    readonly passwordHash: string;
    readonly profile: NewProfile;
    readonly linkIds: () => string;
    readonly now: Date;
  }): Promise<
    | { readonly status: 'created'; readonly guardianAccountId: string }
    | { readonly status: 'invalid' | 'email_taken' }
  > {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Demande verrouillée : deux ouvertures concurrentes du même lien n'en servent qu'une.
        const [setup] = await tx.$queryRaw<
          { id: string; from_account_id: string; new_email: string; from_accepted_at: Date }[]
        >`
          SELECT "id", "from_account_id", "new_email", "from_accepted_at" FROM "profile_transfer"
          WHERE "token_hash" = ${input.tokenHash} AND "kind" = 'WARD' AND "profile_id" IS NULL
            AND "completed_at" IS NULL AND "cancelled_at" IS NULL
            AND "token_expires_at" > ${input.now} AND "expires_at" > ${input.now}
          FOR UPDATE`;
        if (!setup) return { status: 'invalid' as const };
        // AUTH-16 : une adresse réservée par un lien d'annulation ouvert compte comme prise.
        const reserved = await tx.accountToken.count({
          where: {
            purpose: 'EMAIL_CHANGE_CANCEL',
            newEmail: setup.new_email,
            usedAt: null,
            expiresAt: { gt: input.now },
          },
        });
        const existing = await tx.account.count({ where: { email: setup.new_email } });
        if (reserved > 0 || existing > 0) return { status: 'email_taken' as const };

        await tx.account.create({
          data: {
            id: input.accountId,
            email: setup.new_email,
            emailVerifiedAt: input.now,
            passwordHash: input.passwordHash,
            guardianAccountId: setup.from_account_id,
            guardianAttestedAt: setup.from_accepted_at,
            createdAt: input.now,
          },
        });
        await tx.profile.create({
          data: {
            ...input.profile,
            accountId: input.accountId,
            isChild: true,
            createdAt: input.now,
          },
        });
        const adults = await linkToGuardian(
          tx,
          input.profile.id,
          setup.from_account_id,
          input.linkIds,
          input.now,
        );
        // PRO-15 : un enfant sans tuteur ne naît pas ; le tuteur a perdu ses adultes entre-temps.
        if (adults === 0) throw new SetupAborted();
        await tx.profileTransfer.update({
          where: { id: setup.id },
          data: { completedAt: input.now, toAccountId: input.accountId },
        });
        return { status: 'created' as const, guardianAccountId: setup.from_account_id };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return { status: 'email_taken' };
      if (error instanceof SetupAborted) return { status: 'invalid' };
      throw error;
    }
  }

  async listWards(guardianAccountId: string): Promise<WardSummary[]> {
    const rows = await this.prisma.account.findMany({
      where: { guardianAccountId },
      select: WARD,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toSummary);
  }

  async findWard(guardianAccountId: string, wardAccountId: string): Promise<WardSummary | null> {
    const row = await this.prisma.account.findFirst({
      where: { id: wardAccountId, guardianAccountId },
      select: WARD,
    });
    return row ? toSummary(row) : null;
  }

  async createWardProfile(input: {
    readonly wardAccountId: string;
    readonly profile: NewProfile;
    readonly linkIds: () => string;
    readonly now: Date;
  }): Promise<'created' | 'limit' | 'missing'> {
    return this.prisma.$transaction(async (tx) => {
      const [ward] = await tx.$queryRaw<{ guardian_account_id: string | null }[]>`
        SELECT "guardian_account_id" FROM "account" WHERE "id" = ${input.wardAccountId}::uuid
        FOR UPDATE`;
      if (!ward?.guardian_account_id) return 'missing' as const;
      const count = await tx.profile.count({ where: { accountId: input.wardAccountId } });
      if (count >= MAX_PROFILES_PER_ACCOUNT) return 'limit' as const;
      await tx.profile.create({
        data: {
          ...input.profile,
          accountId: input.wardAccountId,
          isChild: true,
          createdAt: input.now,
        },
      });
      await linkToGuardian(
        tx,
        input.profile.id,
        ward.guardian_account_id,
        input.linkIds,
        input.now,
      );
      // PRO-16 : ajouter un profil annule une levée en attente (elle suppose un seul profil).
      await tx.account.update({
        where: { id: input.wardAccountId },
        data: { guardianReleaseRequestedAt: null },
      });
      return 'created' as const;
    });
  }

  async requestRelease(
    guardianAccountId: string,
    wardAccountId: string,
    now: Date,
  ): Promise<'requested' | 'missing' | 'multiple_profiles'> {
    return this.prisma.$transaction(async (tx) => {
      const [ward] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "account"
        WHERE "id" = ${wardAccountId}::uuid AND "guardian_account_id" = ${guardianAccountId}::uuid
        FOR UPDATE`;
      if (!ward) return 'missing' as const;
      if ((await tx.profile.count({ where: { accountId: wardAccountId } })) !== 1) {
        return 'multiple_profiles' as const;
      }
      await tx.account.update({
        where: { id: wardAccountId },
        data: { guardianReleaseRequestedAt: now },
      });
      return 'requested' as const;
    });
  }

  async attestAgeAndRelease(
    wardAccountId: string,
    now: Date,
  ): Promise<
    | {
        readonly status: 'released';
        readonly guardianAccountId: string;
        readonly profileId: string;
      }
    | { readonly status: 'not_requested' | 'multiple_profiles' }
  > {
    return this.prisma.$transaction(async (tx) => {
      const [ward] = await tx.$queryRaw<
        { guardian_account_id: string | null; guardian_release_requested_at: Date | null }[]
      >`
        SELECT "guardian_account_id", "guardian_release_requested_at" FROM "account"
        WHERE "id" = ${wardAccountId}::uuid FOR UPDATE`;
      if (!ward?.guardian_account_id || !ward.guardian_release_requested_at) {
        return { status: 'not_requested' as const };
      }
      const profiles = await tx.profile.findMany({
        where: { accountId: wardAccountId },
        select: { id: true },
      });
      const [profile] = profiles;
      if (profiles.length !== 1 || !profile) return { status: 'multiple_profiles' as const };

      // AUTH-08 : la déclaration d'âge remplace la tutelle, dans la même écriture (`CHECK`).
      await tx.account.update({
        where: { id: wardAccountId },
        data: {
          ageAttestedAt: now,
          guardianAccountId: null,
          guardianAttestedAt: null,
          guardianReleaseRequestedAt: null,
        },
      });
      await tx.profile.update({
        where: { id: profile.id },
        data: {
          isChild: false,
          childChangedAt: now,
          childNoticeAt: now,
          version: { increment: 1 },
        },
      });
      // Les liens de tutelle deviennent ordinaires : la famille reste dans le cercle (LNK-11).
      await tx.profileLink.updateMany({
        where: {
          origin: 'GUARDIANSHIP',
          OR: [{ profileAId: profile.id }, { profileBId: profile.id }],
        },
        data: { origin: 'TRANSFER' },
      });
      // PRO-09 : plus de tuteur pour ses liens encore en attente de validation.
      await tx.profileLink.deleteMany({
        where: {
          status: 'AWAITING_GUARDIAN',
          OR: [
            { profileAId: profile.id, aGuardianRequired: true },
            { profileBId: profile.id, bGuardianRequired: true },
          ],
        },
      });
      // PRO-16 (I7) : les jetons émis par le tuteur pour ce compte ne servent plus.
      await tx.accountToken.updateMany({
        where: { accountId: wardAccountId, purpose: 'PASSWORD_RESET', usedAt: null },
        data: { usedAt: now },
      });
      return {
        status: 'released' as const,
        guardianAccountId: ward.guardian_account_id,
        profileId: profile.id,
      };
    });
  }
}

/** Annule l'installation : le tuteur n'a plus d'adulte pour garder l'enfant. */
class SetupAborted extends Error {}
