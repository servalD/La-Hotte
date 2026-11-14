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
} from '../../src/modules/identity/testing';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile } from '../support/sign-in';

// Profils entre comptes contre PostgreSQL réel (PRO-10 à PRO-15, LNK-11) : contraintes et
// déclencheurs de la migration `profiles_between_accounts`, tuteurs d'un compte sous tutelle lus
// par le dépôt des liens (lot a de la tranche 6 bis).

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
const hashOf = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

async function addProfile(accountId: string, isChild: boolean): Promise<string> {
  const id = randomUUID();
  await prisma.profile.create({
    data: {
      id,
      accountId,
      displayName: 'Profil de test',
      accentColor: '#336699',
      locale: 'fr',
      currency: 'EUR',
      timezone: 'Europe/Paris',
      isChild,
    },
  });
  return id;
}

/** Compte sous tutelle de `guardianAccountId`, avec un profil enfant. */
async function ward(guardianAccountId: string): Promise<{ accountId: string; profileId: string }> {
  const accountId = randomUUID();
  await prisma.account.create({
    data: {
      id: accountId,
      email: `ward-${accountId}@lahotte.test`,
      emailVerifiedAt: new Date(),
      guardianAccountId,
      guardianAttestedAt: new Date(),
    },
  });
  return { accountId, profileId: await addProfile(accountId, true) };
}

function link(a: string, b: string, data: Record<string, unknown>) {
  const [low, high] = a < b ? [a, b] : [b, a];
  return prisma.profileLink.create({
    data: {
      id: randomUUID(),
      profileAId: low,
      profileBId: high,
      requestedBy: low,
      status: 'ACCEPTED',
      aGuardianRequired: false,
      bGuardianRequired: false,
      ...data,
    },
  });
}

describe('compte sous tutelle (PRO-15, AUTH-08, RGPD-06)', () => {
  it('naît sans déclaration d’âge, avec la déclaration d’autorité du tuteur', async () => {
    const guardian = await createAccountWithProfile(prisma);
    const created = await ward(guardian.accountId);
    const row = await prisma.account.findUniqueOrThrow({ where: { id: created.accountId } });
    expect(row.ageAttestedAt).toBeNull();
    expect(row.guardianAccountId).toBe(guardian.accountId);
  });

  it('refuse un compte sans âge ni tuteur, ou un tuteur sans déclaration', async () => {
    const guardian = await createAccountWithProfile(prisma);
    await expect(
      prisma.account.create({
        data: { id: randomUUID(), email: `x-${randomUUID()}@lahotte.test` },
      }),
    ).rejects.toThrow(/account_age_or_guardian/);
    await expect(
      prisma.account.create({
        data: {
          id: randomUUID(),
          email: `x-${randomUUID()}@lahotte.test`,
          ageAttestedAt: new Date(),
          guardianAccountId: guardian.accountId,
        },
      }),
    ).rejects.toThrow(/account_guardian_attested/);
  });

  it('n’admet que des profils enfants, à la création comme au retrait du marqueur', async () => {
    const guardian = await createAccountWithProfile(prisma);
    const created = await ward(guardian.accountId);
    await expect(addProfile(created.accountId, false)).rejects.toThrow(
      /adult profile in a ward account/,
    );
    await expect(
      prisma.profile.update({ where: { id: created.profileId }, data: { isChild: false } }),
    ).rejects.toThrow(/adult profile in a ward account/);
  });

  it('un compte qui a un profil adulte ne passe pas sous tutelle', async () => {
    const guardian = await createAccountWithProfile(prisma);
    const adult = await createAccountWithProfile(prisma);
    await expect(
      prisma.account.update({
        where: { id: adult.accountId },
        data: { guardianAccountId: guardian.accountId, guardianAttestedAt: new Date() },
      }),
    ).rejects.toThrow(/ward account with an adult profile/);
  });

  it('pas de chaîne : ni tuteur sous tutelle, ni tuteur qui passe sous tutelle', async () => {
    const top = await createAccountWithProfile(prisma);
    const first = await ward(top.accountId);
    await expect(ward(first.accountId)).rejects.toThrow(/guardian account is itself a ward/);

    // Un compte tuteur qui n'aurait que des enfants ne passe pas non plus sous tutelle.
    const tutor = await createAccountWithProfile(prisma);
    await ward(tutor.accountId);
    await prisma.profile.update({ where: { id: tutor.profileId }, data: { isChild: true } });
    await expect(
      prisma.account.update({
        where: { id: tutor.accountId },
        data: { guardianAccountId: top.accountId, guardianAttestedAt: new Date() },
      }),
    ).rejects.toThrow(/guardian account cannot become a ward/);
  });

  it('garde le rôle USER, et le tuteur ne se supprime pas tant qu’il a un compte sous tutelle', async () => {
    const guardian = await createAccountWithProfile(prisma);
    const created = await ward(guardian.accountId);
    await expect(
      prisma.account.update({ where: { id: created.accountId }, data: { role: 'MODERATOR' } }),
    ).rejects.toThrow(/account_ward_role_user/);
    await expect(prisma.account.delete({ where: { id: guardian.accountId } })).rejects.toThrow();
  });
});

describe('adresse d’un profil (PRO-10)', () => {
  it('normalisée, absente pour un enfant, vérifiée seulement si elle existe', async () => {
    const { profileId } = await createAccountWithProfile(prisma);
    await prisma.profile.update({
      where: { id: profileId },
      data: { email: 'personne@lahotte.test', emailVerifiedAt: new Date() },
    });
    await expect(
      prisma.profile.update({ where: { id: profileId }, data: { email: 'Personne@Lahotte.test' } }),
    ).rejects.toThrow(/profile_email_normalized/);
    await expect(
      prisma.profile.update({ where: { id: profileId }, data: { isChild: true } }),
    ).rejects.toThrow(/profile_email_not_child/);
    await expect(
      prisma.profile.update({ where: { id: profileId }, data: { email: null } }),
    ).rejects.toThrow(/profile_email_verified_needs_email/);
  });

  it('un jeton de vérification porte le profil et l’adresse', async () => {
    const { accountId, profileId } = await createAccountWithProfile(prisma);
    const base = {
      accountId,
      purpose: 'PROFILE_EMAIL_VERIFY' as const,
      expiresAt: new Date(Date.now() + DAY),
    };
    await prisma.accountToken.create({
      data: {
        ...base,
        id: randomUUID(),
        tokenHash: hashOf(randomUUID()),
        profileId,
        newEmail: 'personne@lahotte.test',
      },
    });
    await expect(
      prisma.accountToken.create({
        data: { ...base, id: randomUUID(), tokenHash: hashOf(randomUUID()), profileId },
      }),
    ).rejects.toThrow(/account_token_new_email/);
    await expect(
      prisma.accountToken.create({
        data: {
          ...base,
          id: randomUUID(),
          tokenHash: hashOf(randomUUID()),
          newEmail: 'personne@lahotte.test',
        },
      }),
    ).rejects.toThrow(/account_token_profile_scope/);
  });
});

describe('demande de changement de compte (PRO-12)', () => {
  function transfer(input: { profileId: string; from: string; to?: string }) {
    return prisma.profileTransfer.create({
      data: {
        id: randomUUID(),
        kind: 'MOVE',
        profileId: input.profileId,
        fromAccountId: input.from,
        toAccountId: input.to ?? null,
        tokenHash: hashOf(randomUUID()),
        profileConsentRequired: true,
        fromAcceptedAt: new Date(),
        pinChoice: 'KEEP',
        tokenExpiresAt: new Date(Date.now() + 7 * DAY),
        expiresAt: new Date(Date.now() + 7 * DAY),
      },
    });
  }

  it('une seule demande ouverte par profil ; une annulée libère la place', async () => {
    const { accountId, profileId } = await createAccountWithProfile(prisma);
    const first = await transfer({ profileId, from: accountId });
    await expect(transfer({ profileId, from: accountId })).rejects.toThrow();
    await prisma.profileTransfer.update({
      where: { id: first.id },
      data: { cancelledAt: new Date() },
    });
    await expect(transfer({ profileId, from: accountId })).resolves.toBeDefined();
  });

  it('jamais vers le compte d’origine', async () => {
    const { accountId, profileId } = await createAccountWithProfile(prisma);
    await expect(transfer({ profileId, from: accountId, to: accountId })).rejects.toThrow(
      /profile_transfer_not_to_self/,
    );
  });
});

describe('liens nés d’un passage ou de la tutelle (LNK-11, PRO-15)', () => {
  it('acceptés sans validateur nommé ; un lien d’invitation, non', async () => {
    const parent = await createAccountWithProfile(prisma);
    const kid = await addProfile((await createAccountWithProfile(prisma)).accountId, true);
    const [low] = parent.profileId < kid ? [parent.profileId, kid] : [kid, parent.profileId];
    const childSide = low === kid ? { aGuardianRequired: true } : { bGuardianRequired: true };
    await expect(
      link(parent.profileId, kid, { ...childSide, origin: 'TRANSFER' }),
    ).resolves.toBeDefined();

    const other = await addProfile((await createAccountWithProfile(prisma)).accountId, true);
    const [low2] = parent.profileId < other ? [parent.profileId, other] : [other, parent.profileId];
    const otherSide = low2 === other ? { aGuardianRequired: true } : { bGuardianRequired: true };
    await expect(link(parent.profileId, other, otherSide)).rejects.toThrow(
      /profile_link_accepted_is_approved/,
    );
  });

  it('un lien de passage ou de tutelle n’attend jamais de validation', async () => {
    const x = await createAccountWithProfile(prisma);
    const y = await createAccountWithProfile(prisma);
    await expect(
      link(x.profileId, y.profileId, {
        origin: 'GUARDIANSHIP',
        status: 'AWAITING_GUARDIAN',
        aGuardianRequired: true,
      }),
    ).rejects.toThrow(/profile_link_non_invitation_accepted/);
  });
});

describe('tuteurs d’un compte sous tutelle (PRO-15, LNK-06)', () => {
  it('seuls les adultes du compte tuteur reliés par un lien de tutelle en sont tuteurs', async () => {
    const guardian = await createAccountWithProfile(prisma);
    const otherAdult = await addProfile(guardian.accountId, false);
    const created = await ward(guardian.accountId);
    await link(guardian.profileId, created.profileId, { origin: 'GUARDIANSHIP' });

    const party = await links.findParty(created.profileId);
    expect(party?.wardGuardianIds).toEqual([guardian.profileId]);
    expect(party?.wardGuardianIds).not.toContain(otherAdult);
  });

  it('le tuteur valide le lien de l’enfant ; un autre adulte du compte tuteur, non', async () => {
    const guardian = await createAccountWithProfile(prisma);
    const otherAdult = await addProfile(guardian.accountId, false);
    const created = await ward(guardian.accountId);
    await link(guardian.profileId, created.profileId, { origin: 'GUARDIANSHIP' });
    const friend = await createAccountWithProfile(prisma);
    const childIsA = created.profileId < friend.profileId;
    const pending = await link(created.profileId, friend.profileId, {
      status: 'AWAITING_GUARDIAN',
      ...(childIsA ? { aGuardianRequired: true } : { bGuardianRequired: true }),
    });
    const side = childIsA ? 'A' : 'B';
    const now = new Date();

    expect(
      await links.approveSide({ linkId: pending.id, side, guardianId: otherAdult, now }),
    ).toBeNull();
    const approved = await links.approveSide({
      linkId: pending.id,
      side,
      guardianId: guardian.profileId,
      now,
    });
    expect(approved?.status).toBe('ACCEPTED');
  });

  it('le tuteur voit les liens de l’enfant ; un lien de tutelle ne se bloque pas', async () => {
    const guardian = await createAccountWithProfile(prisma);
    const created = await ward(guardian.accountId);
    const guardianship = await link(guardian.profileId, created.profileId, {
      origin: 'GUARDIANSHIP',
    });
    const actor = await links.findParty(guardian.profileId);
    if (!actor) throw new Error('profil attendu');
    const seen = await links.listLinks(actor);
    expect(seen.map((l) => l.id)).toContain(guardianship.id);

    const outcome = await links.block({
      id: randomUUID(),
      blockerId: created.profileId,
      blockedId: guardian.profileId,
      now: new Date(),
    });
    expect(outcome).toBe('not_linked');
    expect(await prisma.profileLink.count({ where: { id: guardianship.id } })).toBe(1);
  });
});

describe('journal de sécurité (PRO-11, PRO-14)', () => {
  it('accepte un événement au premier mot composé, avec profil et demande', async () => {
    await expect(
      prisma.securityLog.create({
        data: {
          id: randomUUID(),
          event: 'profile_invitation.created',
          profileId: randomUUID(),
          transferId: randomUUID(),
          ip: '127.0.0.1',
          userAgent: 'test',
        },
      }),
    ).resolves.toBeDefined();
    await expect(
      prisma.securityLog.create({
        data: { id: randomUUID(), event: '_bad.event', ip: '127.0.0.1', userAgent: 'test' },
      }),
    ).rejects.toThrow(/security_log_event_format/);
  });
});
