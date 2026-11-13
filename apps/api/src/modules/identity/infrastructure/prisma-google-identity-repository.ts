import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { GoogleIdentityRepository, type NewGoogleAccount } from '../domain/google.ports';

/**
 * Index d'unicité violé (colonnes ou nom de la contrainte), ou `null` si l'erreur n'en est pas
 * une. Requête brute : `P2010` avec le code PostgreSQL `23505` et le nom de la contrainte dans le
 * message.
 */
function violatedUnique(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const meta = error.meta as { target?: unknown; code?: unknown; message?: unknown } | undefined;
  if (error.code === 'P2002') {
    const target = meta?.target;
    return Array.isArray(target) ? target.join(',') : typeof target === 'string' ? target : '';
  }
  if (error.code === 'P2010' && meta?.code === '23505') {
    return typeof meta.message === 'string' ? meta.message : '';
  }
  return null;
}

/**
 * Identités Google (`auth_identity`, AUTH-03). Requêtes paramétrées seulement (SEC-11) ; l'époque
 * n'est jamais écrite en arrière (`GREATEST`, ADR 0014). Les contraintes d'unicité tranchent les
 * concurrences : (`provider`, `subject`) et (`account_id`, `provider`).
 */
@Injectable()
export class PrismaGoogleIdentityRepository extends GoogleIdentityRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findAccountBySubject(subject: string): Promise<string | null> {
    const row = await this.prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: 'GOOGLE', subject } },
      select: { accountId: true },
    });
    return row?.accountId ?? null;
  }

  async findSubject(accountId: string): Promise<string | null> {
    const row = await this.prisma.authIdentity.findUnique({
      where: { accountId_provider: { accountId, provider: 'GOOGLE' } },
      select: { subject: true },
    });
    return row?.subject ?? null;
  }

  async createAccount(
    account: NewGoogleAccount,
  ): Promise<'created' | 'email_taken' | 'subject_taken'> {
    try {
      await this.prisma.$transaction([
        this.prisma.account.create({
          data: {
            id: account.id,
            email: account.email,
            emailVerifiedAt: account.createdAt,
            passwordHash: null,
            ageAttestedAt: account.ageAttestedAt,
            createdAt: account.createdAt,
          },
        }),
        this.prisma.profile.create({
          data: { ...account.profile, accountId: account.id, createdAt: account.createdAt },
        }),
        this.prisma.authIdentity.create({
          data: {
            id: account.identityId,
            accountId: account.id,
            provider: 'GOOGLE',
            subject: account.subject,
            createdAt: account.createdAt,
          },
        }),
      ]);
      return 'created';
    } catch (error) {
      const target = violatedUnique(error);
      if (target === null) throw error;
      return target.includes('subject') ? 'subject_taken' : 'email_taken';
    }
  }

  async link(input: {
    readonly id: string;
    readonly accountId: string;
    readonly subject: string;
    readonly now: Date;
  }): Promise<'linked' | 'subject_taken' | 'already_linked' | 'not_eligible'> {
    try {
      // Une seule instruction : l'identité n'est insérée que si le compte est actif et vérifié ;
      // les deux index d'unicité tranchent les associations concurrentes.
      const inserted = await this.prisma.$executeRaw`
        INSERT INTO "auth_identity" ("id", "account_id", "provider", "subject", "created_at", "updated_at")
        SELECT ${input.id}::uuid, a."id", 'GOOGLE'::"auth_provider", ${input.subject}, ${input.now}, ${input.now}
        FROM "account" AS a
        WHERE a."id" = ${input.accountId}::uuid
          AND a."status" = 'ACTIVE'
          AND a."email_verified_at" IS NOT NULL`;
      return inserted === 1 ? 'linked' : 'not_eligible';
    } catch (error) {
      const target = violatedUnique(error);
      if (target === null) throw error;
      return target.includes('subject') ? 'subject_taken' : 'already_linked';
    }
  }

  async unlink(
    accountId: string,
    authEpoch: number,
  ): Promise<'unlinked' | 'not_linked' | 'no_password'> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "account" SET "auth_epoch" = GREATEST("auth_epoch", ${authEpoch})
        WHERE "id" = ${accountId}::uuid`;
      const account = await tx.$queryRaw<{ has_password: boolean }[]>`
        SELECT ("password_hash" IS NOT NULL) AS "has_password" FROM "account"
        WHERE "id" = ${accountId}::uuid
        FOR UPDATE`;
      if (!account[0]?.has_password) return 'no_password' as const;
      const removed = await tx.authIdentity.deleteMany({
        where: { accountId, provider: 'GOOGLE' },
      });
      return removed.count === 1 ? ('unlinked' as const) : ('not_linked' as const);
    });
  }
}
