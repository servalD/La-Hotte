import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import {
  AccountRepository,
  BackgroundTasks,
  InMemoryBackgroundTasks,
  InMemoryMailSender,
  LinkRepository,
  MailSender,
  ProfileRepository,
} from '../../src/modules/identity/testing';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile } from '../support/sign-in';

// Liens, blocages et invitations contre PostgreSQL réel (LNK-01 à LNK-10, AUTH-09) : consommation
// conditionnelle sous concurrence, verrou de la paire, contraintes et déclencheurs de la migration.

let app: INestApplication;
let prisma: PrismaService;
let links: LinkRepository;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailSender)
    .useValue(new InMemoryMailSender())
    .overrideProvider(BackgroundTasks)
    .useValue(new InMemoryBackgroundTasks())
    .compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  links = app.get(LinkRepository);
});

afterAll(async () => {
  await app.close();
});

const DAY = 24 * 60 * 60 * 1000;

const hashOf = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

function randomToken(): string {
  return randomUUID().replaceAll('-', '').slice(0, 22);
}

async function person(isChild = false) {
  const created = await createAccountWithProfile(prisma);
  if (isChild) {
    await prisma.profile.update({ where: { id: created.profileId }, data: { isChild: true } });
  }
  return created;
}

async function openInvitation(
  inviterProfileId: string,
  overrides: { expiresAt?: Date; maxUsesOpen?: number } = {},
): Promise<string> {
  const token = randomToken();
  const now = new Date();
  const created = await links.createInvitation({
    id: randomUUID(),
    tokenHash: hashOf(token),
    createdBy: inviterProfileId,
    now,
    expiresAt: overrides.expiresAt ?? new Date(now.getTime() + 7 * DAY),
    maxOpen: overrides.maxUsesOpen ?? 20,
  });
  expect(created).toBe('created');
  return token;
}

function redeem(token: string, redeemerId: string) {
  return links.redeemInvitation({
    tokenHash: hashOf(token),
    redeemerId,
    linkId: randomUUID(),
    now: new Date(),
  });
}

describe('redeemInvitation (LNK-06, LNK-07)', () => {
  it('crée un lien accepté d’office, rangé a < b, et consomme l’invitation', async () => {
    const inviter = await person();
    const guest = await person();
    const token = await openInvitation(inviter.profileId);
    const outcome = await redeem(token, guest.profileId);
    expect(outcome.kind).toBe('linked');
    const rows = await prisma.profileLink.findMany({
      where: { OR: [{ profileAId: inviter.profileId }, { profileBId: inviter.profileId }] },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('ACCEPTED');
    expect((rows[0]?.profileAId ?? '') < (rows[0]?.profileBId ?? '')).toBe(true);
    expect(rows[0]?.requestedBy).toBe(inviter.profileId);
    expect(await redeem(token, (await person()).profileId)).toEqual({ kind: 'invalid' });
  });

  it('deux ouvertures simultanées du même jeton : un seul lien, une seule consommation', async () => {
    const inviter = await person();
    const guests = await Promise.all([person(), person(), person(), person()]);
    const token = await openInvitation(inviter.profileId);
    const outcomes = await Promise.all(guests.map((guest) => redeem(token, guest.profileId)));
    expect(outcomes.filter((outcome) => outcome.kind === 'linked')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === 'invalid')).toHaveLength(3);
    expect(await prisma.profileLink.count({ where: { requestedBy: inviter.profileId } })).toBe(1);
    const stored = await prisma.invitation.findUniqueOrThrow({
      where: { tokenHash: hashOf(token) },
    });
    expect(stored.usedCount).toBe(1);
  });

  it('même compte et lien existant : rien n’est consommé', async () => {
    const inviter = await person();
    const sibling = randomUUID();
    await prisma.profile.create({
      data: {
        id: sibling,
        accountId: inviter.accountId,
        displayName: 'Frère',
        accentColor: '#336699',
        locale: 'fr',
        currency: 'EUR',
        timezone: 'Europe/Paris',
      },
    });
    const token = await openInvitation(inviter.profileId);
    expect(await redeem(token, sibling)).toEqual({ kind: 'same_account' });
    const guest = await person();
    expect((await redeem(token, guest.profileId)).kind).toBe('linked');
    const again = await openInvitation(inviter.profileId);
    expect(await redeem(again, guest.profileId)).toEqual({ kind: 'already_linked' });
    const stored = await prisma.invitation.findUniqueOrThrow({
      where: { tokenHash: hashOf(again) },
    });
    expect(stored.usedCount).toBe(0);
  });

  it('un profil enfant d’un côté : lien en attente, exigence figée à la création (PRO-05)', async () => {
    const kid = await person(true);
    const friend = await person();
    const token = await openInvitation(kid.profileId);
    const outcome = await redeem(token, friend.profileId);
    expect(outcome).toMatchObject({ kind: 'linked', status: 'AWAITING_GUARDIAN' });
    const row = await prisma.profileLink.findFirstOrThrow({
      where: { requestedBy: kid.profileId },
    });
    const kidIsA = row.profileAId === kid.profileId;
    expect(kidIsA ? row.aGuardianRequired : row.bGuardianRequired).toBe(true);
    expect(kidIsA ? row.bGuardianRequired : row.aGuardianRequired).toBe(false);
  });

  it('un lien ne se crée pas à la main entre profils d’un même compte (déclencheur, LNK-03)', async () => {
    const owner = await person();
    const sibling = randomUUID();
    await prisma.profile.create({
      data: {
        id: sibling,
        accountId: owner.accountId,
        displayName: 'Sœur',
        accentColor: '#336699',
        locale: 'fr',
        currency: 'EUR',
        timezone: 'Europe/Paris',
      },
    });
    const [a, b] =
      owner.profileId < sibling ? [owner.profileId, sibling] : [sibling, owner.profileId];
    await expect(
      prisma.profileLink.create({
        data: {
          id: randomUUID(),
          profileAId: a,
          profileBId: b,
          status: 'ACCEPTED',
          requestedBy: a,
          aGuardianRequired: false,
          bGuardianRequired: false,
        },
      }),
    ).rejects.toThrow();
  });
});

describe('approveSide (LNK-06)', () => {
  it('une seule écriture : le lien passe à ACCEPTED quand le dernier côté requis est validé', async () => {
    const kidA = await person(true);
    const kidB = await person(true);
    // Un tuteur est un profil non enfant du compte de l'enfant (revue SEC-40, M2).
    const siblingOf = async (accountId: string): Promise<string> => {
      const id = randomUUID();
      await prisma.profile.create({
        data: {
          id,
          accountId,
          displayName: 'Parent',
          accentColor: '#336699',
          locale: 'fr',
          currency: 'EUR',
          timezone: 'Europe/Paris',
        },
      });
      return id;
    };
    const guardianA = { profileId: await siblingOf(kidA.accountId) };
    const guardianB = { profileId: await siblingOf(kidB.accountId) };
    const token = await openInvitation(kidA.profileId);
    const outcome = await redeem(token, kidB.profileId);
    if (outcome.kind !== 'linked') throw new Error('lien attendu');
    const sideOfA = (await links.findLink(outcome.linkId))?.a.id === kidA.profileId ? 'A' : 'B';
    const sideOfB = sideOfA === 'A' ? 'B' : 'A';
    const now = new Date();
    const first = await links.approveSide({
      linkId: outcome.linkId,
      side: sideOfA,
      guardianId: guardianA.profileId,
      now,
    });
    expect(first?.status).toBe('AWAITING_GUARDIAN');
    // Même côté deux fois : refusé.
    expect(
      await links.approveSide({
        linkId: outcome.linkId,
        side: sideOfA,
        guardianId: guardianA.profileId,
        now,
      }),
    ).toBeNull();
    const second = await links.approveSide({
      linkId: outcome.linkId,
      side: sideOfB,
      guardianId: guardianB.profileId,
      now,
    });
    expect(second?.status).toBe('ACCEPTED');
  });

  it('une contrainte interdit un lien accepté sans toutes ses validations', async () => {
    const kid = await person(true);
    const friend = await person();
    const token = await openInvitation(kid.profileId);
    const outcome = await redeem(token, friend.profileId);
    if (outcome.kind !== 'linked') throw new Error('lien attendu');
    await expect(
      prisma.profileLink.update({ where: { id: outcome.linkId }, data: { status: 'ACCEPTED' } }),
    ).rejects.toThrow();
  });
});

describe('block (LNK-05)', () => {
  it('supprime le lien et enregistre le blocage dans la même transaction', async () => {
    const a = await person();
    const b = await person();
    const outcome = await redeem(await openInvitation(a.profileId), b.profileId);
    if (outcome.kind !== 'linked') throw new Error('lien attendu');
    const result = await links.block({
      id: randomUUID(),
      blockerId: b.profileId,
      blockedId: a.profileId,
      now: new Date(),
    });
    expect(result).toBe('blocked');
    expect(await links.findLink(outcome.linkId)).toBeNull();
    expect(await links.isBlockedEitherWay(a.profileId, b.profileId)).toBe(true);
    expect(await links.membersOf(a.profileId)).not.toContain(b.profileId);
    // Sans lien, on ne bloque pas.
    const stranger = await person();
    expect(
      await links.block({
        id: randomUUID(),
        blockerId: a.profileId,
        blockedId: stranger.profileId,
        now: new Date(),
      }),
    ).toBe('not_linked');
  });

  it('un blocage et une ouverture concurrents ne laissent aucun lien survivre au blocage', async () => {
    for (let round = 0; round < 8; round += 1) {
      const a = await person();
      const b = await person();
      const first = await redeem(await openInvitation(a.profileId), b.profileId);
      if (first.kind !== 'linked') throw new Error('lien attendu');
      const again = await openInvitation(a.profileId);
      await Promise.all([
        links.block({
          id: randomUUID(),
          blockerId: b.profileId,
          blockedId: a.profileId,
          now: new Date(),
        }),
        redeem(again, b.profileId),
      ]);
      const blocked = await links.isBlockedEitherWay(a.profileId, b.profileId);
      const linkCount = await prisma.profileLink.count({
        where: {
          OR: [
            { profileAId: a.profileId, profileBId: b.profileId },
            { profileAId: b.profileId, profileBId: a.profileId },
          ],
        },
      });
      expect(blocked).toBe(true);
      expect(linkCount).toBe(0);
    }
  });
});

describe('invitations (LNK-01, LNK-10)', () => {
  it('plafond d’invitations ouvertes comptées sous verrou, même en rafale', async () => {
    const inviter = await person();
    const results = await Promise.all(
      Array.from({ length: 4 }, async () =>
        links.createInvitation({
          id: randomUUID(),
          tokenHash: hashOf(randomToken()),
          createdBy: inviter.profileId,
          now: new Date(),
          expiresAt: new Date(Date.now() + DAY),
          maxOpen: 2,
        }),
      ),
    );
    expect(results.filter((result) => result === 'created')).toHaveLength(2);
    expect(await links.listOpenInvitations(inviter.profileId, new Date())).toHaveLength(2);
  });

  it('supprimer un profil supprime ses liens et ses invitations (cascade)', async () => {
    const a = await person();
    const b = await person();
    await redeem(await openInvitation(a.profileId), b.profileId);
    await prisma.profile.delete({ where: { id: a.profileId } });
    expect(await prisma.invitation.count({ where: { createdBy: a.profileId } })).toBe(0);
    expect(await links.membersOf(b.profileId)).toEqual([]);
  });

  it('purge : seules les invitations terminées depuis plus de 30 jours disparaissent', async () => {
    const inviter = await person();
    const old = await openInvitation(inviter.profileId);
    const recent = await openInvitation(inviter.profileId);
    await prisma.$executeRaw`
      UPDATE "invitation" SET "created_at" = now() - interval '60 days',
        "expires_at" = now() - interval '31 days' WHERE "token_hash" = ${hashOf(old)}`;
    await prisma.$executeRaw`
      UPDATE "invitation" SET "created_at" = now() - interval '10 days',
        "expires_at" = now() - interval '1 day' WHERE "token_hash" = ${hashOf(recent)}`;
    await links.purgeInvitations(new Date(Date.now() - 30 * DAY));
    expect(await prisma.invitation.count({ where: { tokenHash: hashOf(old) } })).toBe(0);
    expect(await prisma.invitation.count({ where: { tokenHash: hashOf(recent) } })).toBe(1);
  });
});

describe('consumePendingInvitation (AUTH-09, LNK-08)', () => {
  it('crée le lien avec le premier profil et vérifie l’adresse dans la même transaction', async () => {
    const inviter = await person();
    const token = await openInvitation(inviter.profileId);
    const created = await createAccountWithProfile(prisma);
    await prisma.account.update({
      where: { id: created.accountId },
      data: {
        emailVerifiedAt: null,
        pendingInvitationId: (
          await prisma.invitation.findUniqueOrThrow({ where: { tokenHash: hashOf(token) } })
        ).id,
      },
    });
    const outcome = await links.consumePendingInvitation({
      accountId: created.accountId,
      linkId: randomUUID(),
      now: new Date(),
    });
    expect(outcome).toBe('linked');
    const account = await prisma.account.findUniqueOrThrow({ where: { id: created.accountId } });
    expect(account.emailVerifiedAt).not.toBeNull();
    expect(account.pendingInvitationId).toBeNull();
    expect(await links.inCircle(inviter.profileId, created.profileId)).toBe(true);
  });

  it('invitation épuisée : rien n’est écrit, l’adresse reste non vérifiée', async () => {
    const inviter = await person();
    const token = await openInvitation(inviter.profileId);
    await redeem(token, (await person()).profileId);
    const created = await createAccountWithProfile(prisma);
    await prisma.account.update({
      where: { id: created.accountId },
      data: {
        emailVerifiedAt: null,
        pendingInvitationId: (
          await prisma.invitation.findUniqueOrThrow({ where: { tokenHash: hashOf(token) } })
        ).id,
      },
    });
    expect(
      await links.consumePendingInvitation({
        accountId: created.accountId,
        linkId: randomUUID(),
        now: new Date(),
      }),
    ).toBe('exhausted');
    const account = await prisma.account.findUniqueOrThrow({ where: { id: created.accountId } });
    expect(account.emailVerifiedAt).toBeNull();
  });

  it('aucun lien en attente : none', async () => {
    const created = await createAccountWithProfile(prisma);
    expect(
      await links.consumePendingInvitation({
        accountId: created.accountId,
        linkId: randomUUID(),
        now: new Date(),
      }),
    ).toBe('none');
  });
});

describe('setChild (PRO-09)', () => {
  it('un profil qui cesse d’être enfant perd ses liens encore en attente de validation', async () => {
    const kid = await person(true);
    const friend = await person();
    const outcome = await redeem(await openInvitation(kid.profileId), friend.profileId);
    if (outcome.kind !== 'linked') throw new Error('lien attendu');
    const profiles = app.get(ProfileRepository);
    expect(await profiles.setChild(kid.accountId, kid.profileId, false, new Date())).toBe(
      'updated',
    );
    expect(await links.findLink(outcome.linkId)).toBeNull();
    expect(await profiles.setChild(friend.accountId, kid.profileId, true, new Date())).toBe(
      'missing',
    );
  });
});

describe('revue SEC-40 : verrous et éligibilité', () => {
  it('M2 : un profil qui n’est pas tuteur du côté enfant ne le valide pas, même par l’adaptateur', async () => {
    const kid = await person(true);
    const friend = await person();
    const outcome = await redeem(await openInvitation(kid.profileId), friend.profileId);
    if (outcome.kind !== 'linked') throw new Error('lien attendu');
    const kidSide = (await links.findLink(outcome.linkId))?.a.id === kid.profileId ? 'A' : 'B';
    for (const intruder of [friend.profileId, kid.profileId]) {
      expect(
        await links.approveSide({
          linkId: outcome.linkId,
          side: kidSide,
          guardianId: intruder,
          now: new Date(),
        }),
      ).toBeNull();
    }
  });

  it('I2 : le marqueur enfant de celui qui ouvre est relu sous verrou', async () => {
    const profiles = app.get(ProfileRepository);
    for (let round = 0; round < 6; round += 1) {
      const inviter = await person();
      const guest = await person();
      // PRO-12 : le compte garde un adulte, sinon le marquage serait refusé (`GUARDIAN_REQUIRED`).
      await prisma.profile.create({
        data: {
          id: randomUUID(),
          accountId: guest.accountId,
          displayName: 'Adulte',
          accentColor: '#336699',
          locale: 'fr',
          currency: 'EUR',
          timezone: 'Europe/Paris',
        },
      });
      const token = await openInvitation(inviter.profileId);
      const [outcome] = await Promise.all([
        redeem(token, guest.profileId),
        profiles.setChild(guest.accountId, guest.profileId, true, new Date()),
      ]);
      if (outcome.kind !== 'linked') throw new Error('lien attendu');
      const row = await prisma.profileLink.findUniqueOrThrow({ where: { id: outcome.linkId } });
      // Soit créé avant le changement (accepté), soit après (en attente de tuteur) : jamais un lien
      // accepté sans tuteur pour un profil devenu enfant avant sa création.
      const guestIsA = row.profileAId === guest.profileId;
      const required = guestIsA ? row.aGuardianRequired : row.bGuardianRequired;
      if (row.status === 'ACCEPTED') expect(required).toBe(false);
      else expect(required).toBe(true);
    }
  });
});

describe('revue SEC-40, cycle 2 : B1 contre la base', () => {
  it('la réinitialisation ne vérifie pas un compte qui attend une invitation, ni en INVITE_ONLY', async () => {
    const accounts = app.get(AccountRepository);
    const inviter = await person();
    const token = await openInvitation(inviter.profileId);
    const invitation = await prisma.invitation.findUniqueOrThrow({
      where: { tokenHash: hashOf(token) },
    });
    const pending = await createAccountWithProfile(prisma);
    await prisma.account.update({
      where: { id: pending.accountId },
      data: { emailVerifiedAt: null, pendingInvitationId: invitation.id },
    });
    const orphan = await createAccountWithProfile(prisma);
    await prisma.account.update({
      where: { id: orphan.accountId },
      data: { emailVerifiedAt: null },
    });
    const plain = await createAccountWithProfile(prisma);
    await prisma.account.update({
      where: { id: plain.accountId },
      data: { emailVerifiedAt: null },
    });

    const reset = (accountId: string, verifyEmail?: boolean) =>
      accounts.setPassword({
        accountId,
        passwordHash: 'hash-factice',
        authEpoch: 1,
        reset: true,
        ...(verifyEmail === undefined ? {} : { verifyEmail }),
        now: new Date(),
      });
    await reset(pending.accountId);
    await reset(orphan.accountId, false);
    await reset(plain.accountId);
    const verified = async (id: string) =>
      (await prisma.account.findUniqueOrThrow({ where: { id } })).emailVerifiedAt !== null;
    expect(await verified(pending.accountId)).toBe(false);
    expect(await verified(orphan.accountId)).toBe(false);
    expect(await verified(plain.accountId)).toBe(true);
  });
});
