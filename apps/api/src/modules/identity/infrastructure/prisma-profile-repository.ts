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
  version: true,
} as const satisfies Prisma.ProfileSelect;

type DetailsRow = Prisma.ProfileGetPayload<{ select: typeof DETAILS }>;

function toDetails(row: DetailsRow): ProfileDetails {
  const { pinHash, ...rest } = row;
  return { ...rest, hasPin: pinHash !== null };
}

/** Déclencheur `profile_limit_per_account` (PRO-01) : dernier recours si le compte a changé. */
function isProfileLimitViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.message.includes('profile_limit_per_account')
  );
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
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(({ pinHash, ...row }) => ({ ...row, hasPin: pinHash !== null }));
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

  async delete(accountId: string, profileId: string): Promise<'deleted' | 'last' | 'missing'> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "account" WHERE "id" = ${accountId}::uuid FOR UPDATE`;
      const ids = await tx.profile.findMany({ where: { accountId }, select: { id: true } });
      if (!ids.some((row) => row.id === profileId)) return 'missing' as const;
      if (ids.length <= 1) return 'last' as const;
      // `session.active_profile_id` passe à NULL (clé étrangère `SET NULL`).
      await tx.profile.deleteMany({ where: { id: profileId, accountId } });
      return 'deleted' as const;
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
      },
    });
    return count === 1 ? { pinStamp: pinStampOf(input.pinHash) } : null;
  }
}
