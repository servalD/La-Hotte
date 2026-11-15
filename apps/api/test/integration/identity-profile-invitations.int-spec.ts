import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import {
  BackgroundTasks,
  InMemoryBackgroundTasks,
  InMemoryMailSender,
  LinkRepository,
  MailSender,
  ProfileRepository,
} from '../../src/modules/identity/testing';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile } from '../support/sign-in';

// Adresse d'un profil et invitation à créer un profil contre PostgreSQL réel (PRO-10, PRO-11).

let app: INestApplication;
let prisma: PrismaService;
let links: LinkRepository;
let profiles: ProfileRepository;

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
  profiles = app.get(ProfileRepository);
  // Deux connexions ouvertes d'avance (voir identity-wards.int-spec.ts).
  await Promise.all([prisma.$queryRaw`SELECT 1`, prisma.$queryRaw`SELECT 1`]);
});

afterAll(async () => {
  await app.close();
});

const DAY = 24 * 60 * 60 * 1000;
const hashOf = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

function newProfile(displayName = 'Mamie') {
  return {
    id: randomUUID(),
    displayName,
    accentColor: '#336699',
    locale: 'fr',
    currency: 'EUR',
    timezone: 'Europe/Paris',
  };
}

async function profileInvitation(
  inviterProfileId: string,
  targetAccountId: string,
  accepted: boolean,
): Promise<string> {
  const tokenHash = hashOf(randomUUID());
  const now = new Date();
  expect(
    await links.createInvitation({
      id: randomUUID(),
      tokenHash,
      createdBy: inviterProfileId,
      now,
      expiresAt: new Date(now.getTime() + 7 * DAY),
      maxOpen: 20,
      profile: { targetAccountId, profileIsChild: false, accepted },
    }),
  ).toBe('created');
  return tokenHash;
}

function redeem(tokenHash: string) {
  return links.redeemProfileInvitation({
    tokenHash,
    profile: newProfile(),
    pinHash: null,
    linkId: randomUUID(),
    now: new Date(),
  });
}

async function linkProfiles(x: string, y: string): Promise<void> {
  const [a, b] = x < y ? [x, y] : [y, x];
  await prisma.profileLink.create({
    data: {
      id: randomUUID(),
      profileAId: a,
      profileBId: b,
      status: 'ACCEPTED',
      requestedBy: a,
      aGuardianRequired: false,
      bGuardianRequired: false,
    },
  });
}

describe('adresse d’un profil (PRO-10)', () => {
  it('écrite à la vérification seulement, une fois ; les liens d’accord sont désarmés', async () => {
    const owner = await createAccountWithProfile(prisma);
    const tokenHash = hashOf(randomUUID());
    const now = new Date();
    expect(
      await profiles.requestEmailVerification({
        tokenId: randomUUID(),
        accountId: owner.accountId,
        profileId: owner.profileId,
        email: 'moi@lahotte.test',
        tokenHash,
        now,
        expiresAt: new Date(now.getTime() + DAY),
      }),
    ).toBe('issued');
    expect(
      (await prisma.profile.findUniqueOrThrow({ where: { id: owner.profileId } })).email,
    ).toBeNull();
    const results = await Promise.all([
      profiles.confirmEmail(tokenHash, new Date()),
      profiles.confirmEmail(tokenHash, new Date()),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    const row = await prisma.profile.findUniqueOrThrow({ where: { id: owner.profileId } });
    expect(row.email).toBe('moi@lahotte.test');
    expect(row.emailVerifiedAt).not.toBeNull();
    expect(await profiles.clearEmail(owner.accountId, owner.profileId, new Date())).toBe(true);
  });

  it('refusée à un profil enfant', async () => {
    const owner = await createAccountWithProfile(prisma);
    await prisma.profile.update({ where: { id: owner.profileId }, data: { isChild: true } });
    const now = new Date();
    expect(
      await profiles.requestEmailVerification({
        tokenId: randomUUID(),
        accountId: owner.accountId,
        profileId: owner.profileId,
        email: 'kid@lahotte.test',
        tokenHash: hashOf(randomUUID()),
        now,
        expiresAt: new Date(now.getTime() + DAY),
      }),
    ).toBe('child');
  });
});

describe('redeemProfileInvitation (PRO-11)', () => {
  it('deux ouvertures simultanées ne créent qu’un profil', async () => {
    const inviter = await createAccountWithProfile(prisma);
    const tokenHash = await profileInvitation(inviter.profileId, inviter.accountId, true);
    const results = await Promise.all([redeem(tokenHash), redeem(tokenHash)]);
    expect(results.filter((r) => r.status === 'created')).toHaveLength(1);
    expect(await prisma.profile.count({ where: { accountId: inviter.accountId } })).toBe(2);
  });

  it('pas d’acceptation du compte visé : rien n’est consommé', async () => {
    const inviter = await createAccountWithProfile(prisma);
    const target = await createAccountWithProfile(prisma);
    await linkProfiles(inviter.profileId, target.profileId);
    const tokenHash = await profileInvitation(inviter.profileId, target.accountId, false);
    expect((await redeem(tokenHash)).status).toBe('pending');
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { tokenHash } });
    expect(invitation.usedCount).toBe(0);
  });

  it('LNK-05 : un blocage survenu après l’acceptation empêche la création', async () => {
    const inviter = await createAccountWithProfile(prisma);
    const target = await createAccountWithProfile(prisma);
    await linkProfiles(inviter.profileId, target.profileId);
    const tokenHash = await profileInvitation(inviter.profileId, target.accountId, false);
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { tokenHash } });
    expect(
      await links.decideProfileProposal({
        invitationId: invitation.id,
        accountId: target.accountId,
        accept: true,
        now: new Date(),
      }),
    ).toBe('accepted');
    await prisma.profileBlock.create({
      data: { id: randomUUID(), blockerId: target.profileId, blockedId: inviter.profileId },
    });
    expect((await redeem(tokenHash)).status).toBe('invalid');
    expect(await prisma.profile.count({ where: { accountId: target.accountId } })).toBe(1);
  });

  it('PRO-01 : un compte plein ne reçoit pas de profil, et le jeton reste', async () => {
    const inviter = await createAccountWithProfile(prisma);
    for (let i = 0; i < 9; i += 1) {
      await prisma.profile.create({
        data: { ...newProfile(`P${i}`), accountId: inviter.accountId },
      });
    }
    const tokenHash = await profileInvitation(inviter.profileId, inviter.accountId, true);
    expect((await redeem(tokenHash)).status).toBe('limit');
    expect((await prisma.invitation.findUniqueOrThrow({ where: { tokenHash } })).usedCount).toBe(0);
  });

  it('le lien avec l’invitant naît accepté, sans validateur, côté enfant compris', async () => {
    const inviter = await createAccountWithProfile(prisma);
    const target = await createAccountWithProfile(prisma);
    await linkProfiles(inviter.profileId, target.profileId);
    const tokenHash = hashOf(randomUUID());
    const now = new Date();
    await links.createInvitation({
      id: randomUUID(),
      tokenHash,
      createdBy: inviter.profileId,
      now,
      expiresAt: new Date(now.getTime() + 7 * DAY),
      maxOpen: 20,
      profile: { targetAccountId: target.accountId, profileIsChild: true, accepted: true },
    });
    const result = await redeem(tokenHash);
    expect(result.status).toBe('created');
    const created = await prisma.profile.findFirstOrThrow({
      where: { accountId: target.accountId, displayName: 'Mamie' },
    });
    expect(created.isChild).toBe(true);
    expect(created.childChangedAt).not.toBeNull();
    const link = await prisma.profileLink.findFirstOrThrow({
      where: { OR: [{ profileAId: created.id }, { profileBId: created.id }] },
    });
    expect(link.status).toBe('ACCEPTED');
  });
});
