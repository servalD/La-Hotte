import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import {
  CsrfTokens,
  ProfileLockPolicies,
  SessionStore,
} from '../../src/modules/identity/domain/ports';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../src/modules/identity/presentation/cookies';
import type { PrismaService } from '../../src/platform/prisma/prisma.service';

export const WEB_ORIGIN = 'http://localhost:3000';

export interface SignedIn {
  readonly token: string;
  readonly tokenHash: string;
  readonly csrf: string;
  readonly sessionId: string;
  readonly accountId: string;
  readonly profileId: string | null;
  /** En-tête `Cookie` de la session (et du jeton CSRF). */
  readonly cookie: string;
  /** En-têtes d'une mutation légitime : cookie, jeton CSRF, origine. */
  readonly mutation: Record<string, string>;
}

/**
 * Ouvre une session par le cycle de vie réel du module (en attendant les routes de connexion de
 * la tranche 2), et sélectionne le profil s'il est donné. Le compte doit exister dans le stockage.
 */
export async function signIn(
  app: INestApplication,
  input: { accountId: string; profileId?: string | null; userAgent?: string },
): Promise<SignedIn> {
  const lifecycle = app.get(SessionLifecycle);
  const issued = await lifecycle.create({
    accountId: input.accountId,
    observedEpoch: (await lifecycle.observeEpoch(input.accountId)) ?? -1,
    userAgent: input.userAgent ?? 'test-agent',
  });
  const ref = {
    id: issued.record.id,
    accountId: issued.record.accountId,
    tokenHash: issued.record.tokenHash,
  };
  if (input.profileId) await lifecycle.selectProfile(ref, input.profileId);
  return session(
    app,
    issued.token,
    issued.record.tokenHash,
    ref.id,
    ref.accountId,
    input.profileId ?? null,
  );
}

/** En-têtes d'une session dont on connaît le jeton (après rotation, par exemple). */
export function session(
  app: INestApplication,
  token: string,
  tokenHash: string,
  sessionId: string,
  accountId: string,
  profileId: string | null,
): SignedIn {
  const csrf = app.get(CsrfTokens).forSession(tokenHash);
  const cookie = `${SESSION_COOKIE}=${token}; ${CSRF_COOKIE}=${csrf}`;
  return {
    token,
    tokenHash,
    csrf,
    sessionId,
    accountId,
    profileId,
    cookie,
    mutation: { Cookie: cookie, 'X-CSRF-Token': csrf, Origin: WEB_ORIGIN },
  };
}

/** Pose le déverrouillage du profil actif dans le cache, comme le fera la saisie du PIN (tranche 5). */
export async function unlockProfile(
  app: INestApplication,
  signed: SignedIn,
  at: Date,
): Promise<void> {
  if (!signed.profileId) throw new Error('Aucun profil actif');
  // PIN-05 : le déverrouillage porte l'empreinte du PIN courant, lue comme la lit la garde.
  const policy = await app.get(ProfileLockPolicies).find(signed.accountId, signed.profileId);
  await app.get(SessionStore).patchCache(signed.tokenHash, {
    unlock: { profileId: signed.profileId, at, nonce: null, pinStamp: policy?.pinStamp ?? null },
  });
}

/** Compte et profil réels en base (tests d'intégration et de non-fuite). */
export async function createAccountWithProfile(
  prisma: PrismaService,
  input: { pin?: boolean } = {},
): Promise<{ accountId: string; profileId: string }> {
  const accountId = randomUUID();
  const profileId = randomUUID();
  await prisma.account.create({
    data: {
      id: accountId,
      email: `test-${accountId}@lahotte.test`,
      emailVerifiedAt: new Date(),
      ageAttestedAt: new Date(),
    },
  });
  await prisma.profile.create({
    data: {
      id: profileId,
      accountId,
      displayName: 'Profil de test',
      accentColor: '#336699',
      locale: 'fr',
      currency: 'EUR',
      timezone: 'Europe/Paris',
      pinHash: input.pin ? 'hash-factice' : null,
    },
  });
  return { accountId, profileId };
}
