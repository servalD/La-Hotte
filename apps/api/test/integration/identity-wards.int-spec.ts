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
  WardRepository,
} from '../../src/modules/identity/testing';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile } from '../support/sign-in';

// Compte sous tutelle contre PostgreSQL réel (PRO-15, PRO-16, LNK-11) : installation sous
// concurrence, liens d'office, levée, garde des enfants (`GUARDIAN_REQUIRED`).

let app: INestApplication;
let prisma: PrismaService;
let wards: WardRepository;
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
  wards = app.get(WardRepository);
  links = app.get(LinkRepository);
  profiles = app.get(ProfileRepository);
  // Deux connexions ouvertes d'avance : en local, ouvrir une connexion peut prendre près de 2 s
  // (`localhost` essayé en IPv6), plus que l'attente d'une transaction (`maxWait`), et le test de
  // concurrence ci-dessous en ouvre deux à la fois.
  await Promise.all([prisma.$queryRaw`SELECT 1`, prisma.$queryRaw`SELECT 1`]);
});

afterAll(async () => {
  await app.close();
});

const DAY = 24 * 60 * 60 * 1000;
const hashOf = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

function newProfile(displayName = 'Léa') {
  return {
    id: randomUUID(),
    displayName,
    accentColor: '#336699',
    locale: 'fr',
    currency: 'EUR',
    timezone: 'Europe/Paris',
  };
}

async function setupRequest(guardianAccountId: string, email = `w-${randomUUID()}@lahotte.test`) {
  const tokenHash = hashOf(randomUUID());
  const now = new Date();
  await wards.createSetupRequest({
    id: randomUUID(),
    guardianAccountId,
    email,
    profileName: 'Léa',
    tokenHash,
    now,
    tokenExpiresAt: new Date(now.getTime() + DAY),
    expiresAt: new Date(now.getTime() + 7 * DAY),
  });
  return { tokenHash, email };
}

function complete(tokenHash: string) {
  return wards.completeSetup({
    tokenHash,
    accountId: randomUUID(),
    passwordHash: 'hash-factice',
    profile: newProfile(),
    linkIds: () => randomUUID(),
    now: new Date(),
  });
}

async function installed(guardianAccountId: string) {
  const { tokenHash } = await setupRequest(guardianAccountId);
  const result = await complete(tokenHash);
  if (result.status !== 'created') throw new Error('installation attendue');
  const ward = await prisma.account.findFirstOrThrow({
    where: { guardianAccountId },
    orderBy: { createdAt: 'desc' },
    include: { profiles: true },
  });
  const [profile] = ward.profiles;
  if (!profile) throw new Error('profil attendu');
  return { accountId: ward.id, profileId: profile.id };
}

describe('completeSetup (PRO-15)', () => {
  it('crée le compte sous tutelle, son profil enfant et ses liens d’office (LNK-11)', async () => {
    const tutor = await createAccountWithProfile(prisma);
    const childOfTutor = randomUUID();
    await prisma.profile.create({
      data: { ...newProfile('Frère'), id: childOfTutor, accountId: tutor.accountId, isChild: true },
    });
    const ward = await installed(tutor.accountId);
    const row = await prisma.account.findUniqueOrThrow({ where: { id: ward.accountId } });
    expect(row.ageAttestedAt).toBeNull();
    expect(row.guardianAttestedAt).not.toBeNull();
    expect(row.emailVerifiedAt).not.toBeNull();
    const created = await prisma.profileLink.findMany({
      where: { OR: [{ profileAId: ward.profileId }, { profileBId: ward.profileId }] },
    });
    const byOther = new Map(
      created.map((l) => [l.profileAId === ward.profileId ? l.profileBId : l.profileAId, l.origin]),
    );
    expect(byOther.get(tutor.profileId)).toBe('GUARDIANSHIP');
    expect(byOther.get(childOfTutor)).toBe('TRANSFER');
    const party = await links.findParty(ward.profileId);
    expect(party?.wardGuardianIds).toEqual([tutor.profileId]);
  });

  it('deux installations simultanées du même lien ne créent qu’un compte', async () => {
    const tutor = await createAccountWithProfile(prisma);
    const { tokenHash, email } = await setupRequest(tutor.accountId);
    const results = await Promise.all([complete(tokenHash), complete(tokenHash)]);
    expect(results.filter((r) => r.status === 'created')).toHaveLength(1);
    expect(await prisma.account.count({ where: { email } })).toBe(1);
  });

  it('une adresse prise ou réservée (AUTH-16) ne crée rien', async () => {
    const tutor = await createAccountWithProfile(prisma);
    const owner = await createAccountWithProfile(prisma);
    const { tokenHash } = await setupRequest(
      tutor.accountId,
      `test-${owner.accountId}@lahotte.test`,
    );
    expect((await complete(tokenHash)).status).toBe('email_taken');

    const reservedEmail = `r-${randomUUID()}@lahotte.test`;
    await prisma.accountToken.create({
      data: {
        id: randomUUID(),
        accountId: owner.accountId,
        purpose: 'EMAIL_CHANGE_CANCEL',
        tokenHash: hashOf(randomUUID()),
        newEmail: reservedEmail,
        expiresAt: new Date(Date.now() + DAY),
      },
    });
    const reserved = await setupRequest(tutor.accountId, reservedEmail);
    expect((await complete(reserved.tokenHash)).status).toBe('email_taken');
  });

  it('un lien expiré ne sert plus', async () => {
    const tutor = await createAccountWithProfile(prisma);
    const { tokenHash } = await setupRequest(tutor.accountId);
    await prisma.profileTransfer.updateMany({
      where: { tokenHash },
      data: { tokenExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await wards.findOpenSetup(tokenHash, new Date())).toBeNull();
    expect((await complete(tokenHash)).status).toBe('invalid');
  });
});

describe('garde des enfants (PRO-12, PRO-15, GUARDIAN_REQUIRED)', () => {
  it('le seul tuteur d’un enfant ne devient pas enfant, ni n’est supprimé', async () => {
    const tutor = await createAccountWithProfile(prisma);
    await installed(tutor.accountId);
    // Arrivé après l'installation : adulte du compte tuteur, mais sans lien de tutelle (I1).
    const unrelatedAdult = randomUUID();
    await prisma.profile.create({
      data: { ...newProfile('Autre'), id: unrelatedAdult, accountId: tutor.accountId },
    });
    expect(await profiles.setChild(tutor.accountId, tutor.profileId, true, new Date())).toBe(
      'guardian_required',
    );
    expect(await profiles.delete(tutor.accountId, tutor.profileId)).toBe('guardian_required');
    // L'autre adulte, sans lien de tutelle, peut changer.
    expect(await profiles.setChild(tutor.accountId, unrelatedAdult, true, new Date())).toBe(
      'updated',
    );
    const kept = await prisma.profile.findUniqueOrThrow({ where: { id: tutor.profileId } });
    expect(kept.isChild).toBe(false);
  });

  it('le dernier lien de tutelle ne se rompt pas', async () => {
    const tutor = await createAccountWithProfile(prisma);
    const ward = await installed(tutor.accountId);
    const guardianship = await prisma.profileLink.findFirstOrThrow({
      where: {
        origin: 'GUARDIANSHIP',
        OR: [{ profileAId: ward.profileId }, { profileBId: ward.profileId }],
      },
    });
    expect(await links.deleteLink(guardianship.id)).toBe('guardian_required');
    expect(await prisma.profileLink.count({ where: { id: guardianship.id } })).toBe(1);
  });

  it('PRO-15 : le marqueur d’un profil sous tutelle ne change pas', async () => {
    const tutor = await createAccountWithProfile(prisma);
    const ward = await installed(tutor.accountId);
    expect(await profiles.setChild(ward.accountId, ward.profileId, false, new Date())).toBe('ward');
  });

  it('PRO-09 : marquer enfant date le changement et annule les demandes ouvertes', async () => {
    const parent = await createAccountWithProfile(prisma);
    const other = randomUUID();
    await prisma.profile.create({
      data: { ...newProfile('Ado'), id: other, accountId: parent.accountId },
    });
    const transfer = await prisma.profileTransfer.create({
      data: {
        id: randomUUID(),
        kind: 'MOVE',
        profileId: other,
        fromAccountId: parent.accountId,
        tokenHash: hashOf(randomUUID()),
        tokenExpiresAt: new Date(Date.now() + 7 * DAY),
        profileConsentRequired: true,
        fromAcceptedAt: new Date(),
        pinChoice: 'KEEP',
        expiresAt: new Date(Date.now() + 7 * DAY),
      },
    });
    expect(await profiles.setChild(parent.accountId, other, true, new Date())).toBe('updated');
    const row = await prisma.profile.findUniqueOrThrow({ where: { id: other } });
    expect(row.childChangedAt).not.toBeNull();
    expect(row.childNoticeAt).not.toBeNull();
    const cancelled = await prisma.profileTransfer.findUniqueOrThrow({
      where: { id: transfer.id },
    });
    expect(cancelled.cancelledAt).not.toBeNull();
  });
});

describe('profil ajouté et levée (PRO-16)', () => {
  it('un profil ajouté naît lié au tuteur et annule une levée en attente', async () => {
    const tutor = await createAccountWithProfile(prisma);
    const ward = await installed(tutor.accountId);
    expect(await wards.requestRelease(tutor.accountId, ward.accountId, new Date())).toBe(
      'requested',
    );
    const sibling = newProfile('Tom');
    expect(
      await wards.createWardProfile({
        wardAccountId: ward.accountId,
        profile: sibling,
        linkIds: () => randomUUID(),
        now: new Date(),
      }),
    ).toBe('created');
    const row = await prisma.account.findUniqueOrThrow({ where: { id: ward.accountId } });
    expect(row.guardianReleaseRequestedAt).toBeNull();
    expect((await links.findParty(sibling.id))?.wardGuardianIds).toEqual([tutor.profileId]);
    expect(await wards.requestRelease(tutor.accountId, ward.accountId, new Date())).toBe(
      'multiple_profiles',
    );
  });

  it('la levée rend le compte autonome, le profil adulte, les liens ordinaires', async () => {
    const tutor = await createAccountWithProfile(prisma);
    const ward = await installed(tutor.accountId);
    await prisma.accountToken.create({
      data: {
        id: randomUUID(),
        accountId: ward.accountId,
        purpose: 'PASSWORD_RESET',
        tokenHash: hashOf(randomUUID()),
        expiresAt: new Date(Date.now() + DAY),
      },
    });
    expect((await wards.attestAgeAndRelease(ward.accountId, new Date())).status).toBe(
      'not_requested',
    );
    await wards.requestRelease(tutor.accountId, ward.accountId, new Date());
    const released = await wards.attestAgeAndRelease(ward.accountId, new Date());
    expect(released.status).toBe('released');

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ward.accountId } });
    expect(account.guardianAccountId).toBeNull();
    expect(account.ageAttestedAt).not.toBeNull();
    const profile = await prisma.profile.findUniqueOrThrow({ where: { id: ward.profileId } });
    expect(profile.isChild).toBe(false);
    expect(
      await prisma.profileLink.count({
        where: {
          origin: 'GUARDIANSHIP',
          OR: [{ profileAId: ward.profileId }, { profileBId: ward.profileId }],
        },
      }),
    ).toBe(0);
    expect(
      await prisma.accountToken.count({
        where: { accountId: ward.accountId, purpose: 'PASSWORD_RESET', usedAt: null },
      }),
    ).toBe(0);
    expect(await wards.findWard(tutor.accountId, ward.accountId)).toBeNull();
  });
});
