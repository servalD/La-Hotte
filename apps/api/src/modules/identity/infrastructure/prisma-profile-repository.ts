import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import type { NewProfile } from '../domain/account';
import {
  MAX_PROFILES_PER_ACCOUNT,
  PIN_FAILURE_THRESHOLD,
  PIN_LOCK_STEPS_MS,
  type PinAttempt,
  type ProfileChanges,
  type ProfileDetails,
  type ProfileMetadata,
} from '../domain/profile';
import { ProfileRepository } from '../domain/profile.ports';
import { pinStampOf } from './pin-stamp';

const DETAILS = {
  id: true,
  accountId: true,
  displayName: true,
  avatar: true,
  accentColor: true,
  birthdayDay: true,
  birthdayMonth: true,
  birthdayYear: true,
  locale: true,
  currency: true,
  timezone: true,
  isChild: true,
  pinHash: true,
  pinRelock: true,
  pinResetNoticeAt: true,
  email: true,
  emailVerifiedAt: true,
  childNoticeAt: true,
  version: true,
} as const satisfies Prisma.ProfileSelect;

type DetailsRow = Prisma.ProfileGetPayload<{ select: typeof DETAILS }>;

function toDetails(row: DetailsRow): ProfileDetails {
  const { pinHash, emailVerifiedAt, email, ...rest } = row;
  return { ...rest, email: emailVerifiedAt ? email : null, hasPin: pinHash !== null };
}

/** Déclencheur `profile_limit_per_account` (PRO-01) : dernier recours si le compte a changé. */
function isProfileLimitViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.message.includes('profile_limit_per_account')
  );
}

type Tx = Prisma.TransactionClient;

/** Annule la transaction : le changement laisserait un enfant sans adulte responsable. */
class GuardianGap extends Error {}

/** Transaction dont un `GuardianGap` levé à l'intérieur devient `guardian_required`. */
async function guardedTransaction<T>(
  prisma: PrismaService,
  work: (tx: Tx) => Promise<T>,
): Promise<T | 'guardian_required'> {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    if (error instanceof GuardianGap) return 'guardian_required';
    throw error;
  }
}

/**
 * PRO-12, PRO-15 : le compte manque d'adulte responsable : hors tutelle, il a des profils, tous
 * enfants ; ou l'un de ses comptes sous tutelle a un enfant sans lien de tutelle vers un adulte de
 * ce compte. Comparé avant et après un changement : seul un manque **créé** est refusé.
 */
export async function guardianGap(tx: Tx, accountId: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<[{ gap: boolean }]>`
    SELECT (
      EXISTS (
        SELECT 1 FROM "account" a
        WHERE a."id" = ${accountId}::uuid AND a."guardian_account_id" IS NULL
          AND EXISTS (SELECT 1 FROM "profile" p WHERE p."account_id" = a."id")
          AND NOT EXISTS (SELECT 1 FROM "profile" p WHERE p."account_id" = a."id" AND NOT p."is_child"))
      OR EXISTS (
        SELECT 1 FROM "account" w JOIN "profile" c ON c."account_id" = w."id"
        WHERE w."guardian_account_id" = ${accountId}::uuid
          AND NOT EXISTS (
            SELECT 1 FROM "profile_link" l
            JOIN "profile" g ON g."id" = CASE WHEN l."profile_a_id" = c."id"
              THEN l."profile_b_id" ELSE l."profile_a_id" END
            WHERE l."origin" = 'GUARDIANSHIP'
              AND (l."profile_a_id" = c."id" OR l."profile_b_id" = c."id")
              AND g."account_id" = w."guardian_account_id" AND NOT g."is_child"))
    ) AS gap`;
  return row.gap;
}

/**
 * Profils en PostgreSQL (PRO-01 à PRO-08, PIN-03 à PIN-05). Chaque requête est limitée au compte
 * de la session (SEC-03). Créer et supprimer prennent le verrou de la ligne du compte : le nombre
 * de profils (1 à 10) ne se contourne pas par des requêtes concurrentes.
 */
@Injectable()
export class PrismaProfileRepository extends ProfileRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listIds(accountId: string): Promise<string[]> {
    const rows = await this.prisma.profile.findMany({
      where: { accountId },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => row.id);
  }

  async listMetadata(accountId: string): Promise<ProfileMetadata[]> {
    const rows = await this.prisma.profile.findMany({
      where: { accountId },
      select: {
        id: true,
        displayName: true,
        avatar: true,
        accentColor: true,
        pinHash: true,
        isChild: true,
        emailVerifiedAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(({ pinHash, emailVerifiedAt, ...row }) => ({
      ...row,
      hasPin: pinHash !== null,
      hasEmail: emailVerifiedAt !== null,
    }));
  }

  async requestEmailVerification(input: {
    readonly tokenId: string;
    readonly accountId: string;
    readonly profileId: string;
    readonly email: string;
    readonly tokenHash: string;
    readonly now: Date;
    readonly expiresAt: Date;
  }): Promise<'issued' | 'missing' | 'child'> {
    return this.prisma.$transaction(async (tx) => {
      const [profile] = await tx.$queryRaw<{ is_child: boolean }[]>`
        SELECT "is_child" FROM "profile"
        WHERE "id" = ${input.profileId}::uuid AND "account_id" = ${input.accountId}::uuid
        FOR UPDATE`;
      if (!profile) return 'missing' as const;
      if (profile.is_child) return 'child' as const;
      await tx.accountToken.updateMany({
        where: { profileId: input.profileId, purpose: 'PROFILE_EMAIL_VERIFY', usedAt: null },
        data: { usedAt: input.now },
      });
      await tx.accountToken.create({
        data: {
          id: input.tokenId,
          accountId: input.accountId,
          profileId: input.profileId,
          purpose: 'PROFILE_EMAIL_VERIFY',
          tokenHash: input.tokenHash,
          newEmail: input.email,
          createdAt: input.now,
          expiresAt: input.expiresAt,
        },
      });
      return 'issued' as const;
    });
  }

  async confirmEmail(
    tokenHash: string,
    now: Date,
  ): Promise<{ readonly accountId: string; readonly profileId: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      // Usage unique par une écriture conditionnelle : deux ouvertures simultanées, un seul succès.
      const [token] = await tx.$queryRaw<
        { account_id: string; profile_id: string | null; new_email: string | null }[]
      >`
        UPDATE "account_token" t SET "used_at" = ${now}, "updated_at" = ${now}
        FROM "account" a
        WHERE t."token_hash" = ${tokenHash} AND t."purpose" = 'PROFILE_EMAIL_VERIFY'
          AND t."used_at" IS NULL AND t."expires_at" > ${now}
          AND a."id" = t."account_id" AND a."status" = 'ACTIVE'
        RETURNING t."account_id", t."profile_id", t."new_email"`;
      if (!token?.profile_id || !token.new_email) return null;
      const { count } = await tx.profile.updateMany({
        where: { id: token.profile_id, accountId: token.account_id, isChild: false },
        data: { email: token.new_email, emailVerifiedAt: now },
      });
      if (count === 0) return null;
      // PRO-10 : les liens envoyés à l'ancienne adresse ne servent plus.
      await tx.accountToken.updateMany({
        where: {
          profileId: token.profile_id,
          purpose: { in: ['TRANSFER_CONSENT', 'TRANSFER_CANCEL'] },
          usedAt: null,
        },
        data: { usedAt: now },
      });
      return { accountId: token.account_id, profileId: token.profile_id };
    });
  }

  async clearChildNotice(accountId: string, profileId: string): Promise<boolean> {
    const { count } = await this.prisma.profile.updateMany({
      where: { id: profileId, accountId },
      data: { childNoticeAt: null },
    });
    return count > 0;
  }

  async clearEmail(accountId: string, profileId: string, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.profile.updateMany({
        where: { id: profileId, accountId },
        data: { email: null, emailVerifiedAt: null },
      });
      if (count === 0) return false;
      await tx.accountToken.updateMany({
        where: {
          profileId,
          purpose: { in: ['PROFILE_EMAIL_VERIFY', 'TRANSFER_CONSENT', 'TRANSFER_CANCEL'] },
          usedAt: null,
        },
        data: { usedAt: now },
      });
      return true;
    });
  }

  async findDetails(accountId: string, profileId: string): Promise<ProfileDetails | null> {
    const row = await this.prisma.profile.findFirst({
      where: { id: profileId, accountId },
      select: DETAILS,
    });
    return row ? toDetails(row) : null;
  }

  async create(
    accountId: string,
    profile: NewProfile & { readonly isChild: boolean },
    now: Date,
  ): Promise<'created' | 'limit'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "account" WHERE "id" = ${accountId}::uuid FOR UPDATE`;
        const count = await tx.profile.count({ where: { accountId } });
        if (count >= MAX_PROFILES_PER_ACCOUNT) return 'limit' as const;
        await tx.profile.create({ data: { ...profile, accountId, createdAt: now } });
        return 'created' as const;
      });
    } catch (error) {
      if (isProfileLimitViolation(error)) return 'limit';
      throw error;
    }
  }

  async update(
    accountId: string,
    profileId: string,
    expectedVersion: number,
    changes: ProfileChanges,
  ): Promise<
    | { readonly status: 'updated'; readonly profile: ProfileDetails }
    | { readonly status: 'stale' | 'missing' }
  > {
    const data: Prisma.ProfileUpdateManyMutationInput = { version: { increment: 1 } };
    if (changes.displayName !== undefined) data.displayName = changes.displayName;
    if (changes.locale !== undefined) data.locale = changes.locale;
    if (changes.currency !== undefined) data.currency = changes.currency;
    if (changes.timezone !== undefined) data.timezone = changes.timezone;
    if (changes.pinRelock !== undefined) data.pinRelock = changes.pinRelock;
    if (changes.birthday !== undefined) {
      data.birthdayDay = changes.birthday?.day ?? null;
      data.birthdayMonth = changes.birthday?.month ?? null;
      data.birthdayYear = changes.birthday?.year ?? null;
    }
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.profile.updateMany({
        where: { id: profileId, accountId, version: expectedVersion },
        data,
      });
      const row = await tx.profile.findFirst({
        where: { id: profileId, accountId },
        select: DETAILS,
      });
      if (!row) return { status: 'missing' as const };
      if (count === 0) return { status: 'stale' as const };
      return { status: 'updated' as const, profile: toDetails(row) };
    });
  }

  async delete(
    accountId: string,
    profileId: string,
  ): Promise<'deleted' | 'last' | 'missing' | 'guardian_required'> {
    return guardedTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "account" WHERE "id" = ${accountId}::uuid FOR UPDATE`;
      const ids = await tx.profile.findMany({ where: { accountId }, select: { id: true } });
      if (!ids.some((row) => row.id === profileId)) return 'missing' as const;
      if (ids.length <= 1) return 'last' as const;
      const gapBefore = await guardianGap(tx, accountId);
      // `session.active_profile_id` passe à NULL (clé étrangère `SET NULL`).
      await tx.profile.deleteMany({ where: { id: profileId, accountId } });
      if (!gapBefore && (await guardianGap(tx, accountId))) throw new GuardianGap();
      return 'deleted' as const;
    });
  }

  async setChild(
    accountId: string,
    profileId: string,
    isChild: boolean,
    now: Date,
  ): Promise<'updated' | 'missing' | 'ward' | 'guardian_required'> {
    return guardedTransaction(this.prisma, async (tx) => {
      // Revue SEC-40 (M7) : demande ouverte d'abord, puis compte, comme l'exécution d'un passage.
      await tx.$queryRaw`
        SELECT "id" FROM "profile_transfer"
        WHERE "profile_id" = ${profileId}::uuid AND "completed_at" IS NULL
          AND "cancelled_at" IS NULL
        FOR UPDATE`;
      const [account] = await tx.$queryRaw<{ guardian_account_id: string | null }[]>`
        SELECT "guardian_account_id" FROM "account" WHERE "id" = ${accountId}::uuid FOR UPDATE`;
      if (!account) return 'missing' as const;
      // PRO-15 : dans un compte sous tutelle, le marqueur ne change pas, dans aucun sens.
      if (account.guardian_account_id !== null) {
        const owned = await tx.profile.count({ where: { id: profileId, accountId } });
        return owned === 0 ? ('missing' as const) : ('ward' as const);
      }
      const gapBefore = await guardianGap(tx, accountId);
      const { count } = await tx.profile.updateMany({
        where: { id: profileId, accountId },
        data: {
          isChild,
          version: { increment: 1 },
          // PRO-09, PRO-12 : daté (accord du profil gardé 30 jours), notice à l'entrée.
          childChangedAt: now,
          childNoticeAt: now,
          // PRO-10 : un profil enfant n'a pas d'adresse.
          ...(isChild ? { email: null, emailVerifiedAt: null } : {}),
        },
      });
      if (count === 0) return 'missing' as const;
      // PRO-12 (B3) : tout changement du marqueur annule les demandes ouvertes du profil.
      await tx.profileTransfer.updateMany({
        where: { profileId, completedAt: null, cancelledAt: null },
        data: { cancelledAt: now },
      });
      // PRO-09 : un profil qui cesse d'être enfant n'a plus de tuteur ; ses liens encore en attente
      // de validation ne pourraient plus être approuvés. Ils sont supprimés (il faut réinviter).
      if (!isChild) {
        await tx.profileLink.deleteMany({
          where: {
            status: 'AWAITING_GUARDIAN',
            OR: [
              { profileAId: profileId, aGuardianRequired: true },
              { profileBId: profileId, bGuardianRequired: true },
            ],
          },
        });
      }
      if (!gapBefore && (await guardianGap(tx, accountId))) throw new GuardianGap();
      return 'updated' as const;
    });
  }

  async countPinAttempt(
    accountId: string,
    profileId: string,
    now: Date,
  ): Promise<PinAttempt | null> {
    const [step0, step1, step2, step3] = PIN_LOCK_STEPS_MS;
    // PIN-03 : une seule écriture conditionnelle. Hors attente, l'essai est compté comme une
    // erreur avant d'être évalué ; au seuil, l'attente suivante est posée dans la même écriture.
    // Une rafale parallèle ne passe donc pas le seuil, puis un seul essai passe par attente.
    const counted = await this.prisma.$queryRaw<{ pin_hash: string; pin_failed_count: number }[]>`
      UPDATE "profile" SET
        "pin_failed_count" = "pin_failed_count" + 1,
        "pin_failures_since_entry" = "pin_failures_since_entry" + 1,
        "pin_locked_until" = CASE
          WHEN "pin_failed_count" + 1 < ${PIN_FAILURE_THRESHOLD} THEN NULL
          ELSE ${now}::timestamptz + make_interval(secs => (CASE LEAST("pin_failed_count" + 1 - ${PIN_FAILURE_THRESHOLD}, 3)
            WHEN 0 THEN ${step0}::int
            WHEN 1 THEN ${step1}::int
            WHEN 2 THEN ${step2}::int
            ELSE ${step3}::int END) / 1000.0)
        END
      WHERE "id" = ${profileId}::uuid
        AND "account_id" = ${accountId}::uuid
        AND "pin_hash" IS NOT NULL
        AND ("pin_locked_until" IS NULL OR "pin_locked_until" <= ${now}::timestamptz)
      RETURNING "pin_hash", "pin_failed_count"`;
    const row = counted[0];
    if (row) {
      return {
        kind: 'counted',
        pinHash: row.pin_hash,
        pinStamp: pinStampOf(row.pin_hash) ?? '',
        failures: row.pin_failed_count,
      };
    }

    const current = await this.prisma.profile.findFirst({
      where: { id: profileId, accountId },
      select: { pinHash: true, pinLockedUntil: true },
    });
    if (!current) return null;
    if (current.pinHash === null) return { kind: 'no_pin' };
    const retryAfterMs = (current.pinLockedUntil?.getTime() ?? now.getTime()) - now.getTime();
    // Attente expirée entre les deux lectures : un nouvel essai est permis tout de suite.
    return { kind: 'locked', retryAfterMs: Math.max(1000, retryAfterMs) };
  }

  async recordPinSuccess(
    accountId: string,
    profileId: string,
    verifiedHash: string,
  ): Promise<boolean> {
    // L'essai juste a été compté d'avance comme une erreur : il est retiré des erreurs depuis la
    // dernière entrée, qui restent jusqu'à l'entrée suivante (PIN-03).
    const count = await this.prisma.$executeRaw`
      UPDATE "profile" SET
        "pin_failed_count" = 0,
        "pin_locked_until" = NULL,
        "pin_failures_since_entry" = GREATEST("pin_failures_since_entry" - 1, 0)
      WHERE "id" = ${profileId}::uuid
        AND "account_id" = ${accountId}::uuid
        AND "pin_hash" = ${verifiedHash}`;
    return count === 1;
  }

  async takeFailuresSinceEntry(accountId: string, profileId: string): Promise<number> {
    // Lecture et remise à zéro en une instruction : deux entrées concurrentes ne le comptent
    // qu'une fois (la seconde relit la ligne modifiée après le verrou de la première).
    const rows = await this.prisma.$queryRaw<{ pin_failures_since_entry: number }[]>`
      WITH previous AS (
        SELECT "id", "pin_failures_since_entry" FROM "profile"
        WHERE "id" = ${profileId}::uuid AND "account_id" = ${accountId}::uuid
        FOR UPDATE
      )
      UPDATE "profile" AS p SET "pin_failures_since_entry" = 0
      FROM previous
      WHERE p."id" = previous."id"
      RETURNING previous."pin_failures_since_entry"`;
    return rows[0]?.pin_failures_since_entry ?? 0;
  }

  async setPin(input: {
    readonly accountId: string;
    readonly profileId: string;
    readonly pinHash: string | null;
    readonly expectedHash?: string | null;
    readonly resetNoticeAt: Date | null;
  }): Promise<{ readonly pinStamp: string | null } | null> {
    const where: Prisma.ProfileWhereInput = { id: input.profileId, accountId: input.accountId };
    if (input.expectedHash !== undefined) where.pinHash = input.expectedHash;
    // Les erreurs depuis la dernière entrée ne sont pas effacées : seule l'entrée les montre.
    const { count } = await this.prisma.profile.updateMany({
      where,
      data: {
        pinHash: input.pinHash,
        pinFailedCount: 0,
        pinLockedUntil: null,
        pinResetNoticeAt: input.resetNoticeAt,
        // PIN-05, PRO-12 (B4 bis) : une réinitialisation ou désactivation est datée, et PIN-04 ne
        // l'efface pas (la notice, si).
        ...(input.resetNoticeAt ? { pinResetAt: input.resetNoticeAt } : {}),
      },
    });
    return count === 1 ? { pinStamp: pinStampOf(input.pinHash) } : null;
  }
}
