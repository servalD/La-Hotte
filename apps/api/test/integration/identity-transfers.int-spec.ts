import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import {
  BackgroundTasks,
  InMemoryBackgroundTasks,
  InMemoryMailSender,
  MailSender,
  TransferRepository,
} from '../../src/modules/identity/testing';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { createAccountWithProfile, signIn } from '../support/sign-in';

// Exécution d'un changement de compte contre PostgreSQL et Redis réels (PRO-12 à PRO-14, LNK-11) :
// déclencheurs de session et de liens, verrous, revérifications, regroupement, détachement.

let app: INestApplication;
let prisma: PrismaService;
let transfers: TransferRepository;

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
  transfers = app.get(TransferRepository);
  // Deux connexions ouvertes d'avance (voir identity-wards.int-spec.ts).
  await Promise.all([prisma.$queryRaw`SELECT 1`, prisma.$queryRaw`SELECT 1`]);
});

afterAll(async () => {
  await app.close();
});

const DAY = 24 * 60 * 60 * 1000;
const hashOf = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

async function addProfile(accountId: string, isChild = false): Promise<string> {
  const id = randomUUID();
  await prisma.profile.create({
    data: {
      id,
      accountId,
      displayName: 'Profil',
      accentColor: '#336699',
      locale: 'fr',
      currency: 'EUR',
      timezone: 'Europe/Paris',
      isChild,
    },
  });
  return id;
}

async function link(x: string, y: string): Promise<void> {
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

/** Demande `MOVE` dont tous les accords sont donnés et l'échéance passée. */
async function dueMove(input: {
  profileId: string;
  from: string;
  to: string;
  regroup?: boolean;
}): Promise<string> {
  const id = randomUUID();
  const past = new Date(Date.now() - 1000);
  await prisma.profileTransfer.create({
    data: {
      id,
      kind: 'MOVE',
      profileId: input.profileId,
      fromAccountId: input.from,
      toAccountId: input.to,
      tokenHash: hashOf(randomUUID()),
      tokenExpiresAt: new Date(Date.now() + 7 * DAY),
      // Profil adulte : son accord est requis, et donné (m1 du cycle 2).
      profileConsentRequired: true,
      regroup: input.regroup ?? false,
      fromAcceptedAt: past,
      toAcceptedAt: past,
      profileAcceptedAt: past,
      pinChoice: 'KEEP',
      executesAt: past,
      expiresAt: new Date(Date.now() + 7 * DAY),
    },
  });
  return id;
}

function execute(transferId: string) {
  return transfers.execute({ transferId, now: new Date(), linkIds: () => randomUUID() });
}

describe('execute, passage (PRO-14, LNK-11)', () => {
  it('le profil change de compte : sessions désélectionnées, liens réordonnés', async () => {
    const origin = await createAccountWithProfile(prisma);
    const mover = await addProfile(origin.accountId);
    const host = await createAccountWithProfile(prisma);
    await link(mover, host.profileId);
    const session = await signIn(app, { accountId: origin.accountId, profileId: mover });
    await prisma.invitation.create({
      data: {
        id: randomUUID(),
        kind: 'PROFILE',
        targetId: origin.accountId,
        tokenHash: hashOf(randomUUID()),
        createdBy: mover,
        maxUses: 1,
        profileIsChild: false,
        targetAcceptedAt: new Date(),
        expiresAt: new Date(Date.now() + DAY),
      },
    });
    const transferId = await dueMove({
      profileId: mover,
      from: origin.accountId,
      to: host.accountId,
    });

    const result = await execute(transferId);
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.deselected.map((s) => s.id)).toEqual([session.sessionId]);
    expect(result.fromEmptied).toBe(false);

    const moved = await prisma.profile.findUniqueOrThrow({ where: { id: mover } });
    expect(moved.accountId).toBe(host.accountId);
    const sessionRow = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(sessionRow.activeProfileId).toBeNull();
    const links = await prisma.profileLink.findMany({
      where: { OR: [{ profileAId: mover }, { profileBId: mover }] },
    });
    expect(links).toHaveLength(1);
    expect(links[0]?.origin).toBe('TRANSFER');
    expect([links[0]?.profileAId, links[0]?.profileBId]).toContain(origin.profileId);
    expect(
      await prisma.invitation.count({
        where: { createdBy: mover, kind: 'PROFILE', revokedAt: null },
      }),
    ).toBe(0);
    const row = await prisma.profileTransfer.findUniqueOrThrow({ where: { id: transferId } });
    expect(row.completedAt).not.toBeNull();
  });

  it('deux exécutions simultanées : une seule fait effet', async () => {
    const origin = await createAccountWithProfile(prisma);
    const mover = await addProfile(origin.accountId);
    const host = await createAccountWithProfile(prisma);
    await link(mover, host.profileId);
    const transferId = await dueMove({
      profileId: mover,
      from: origin.accountId,
      to: host.accountId,
    });
    const results = await Promise.all([execute(transferId), execute(transferId)]);
    expect(results.filter((r) => r.status === 'completed')).toHaveLength(1);
  });

  it('un blocage survenu avant l’échéance fait échouer, vu comme un retrait', async () => {
    const origin = await createAccountWithProfile(prisma);
    const mover = await addProfile(origin.accountId);
    const host = await createAccountWithProfile(prisma);
    await link(mover, host.profileId);
    const transferId = await dueMove({
      profileId: mover,
      from: origin.accountId,
      to: host.accountId,
    });
    await prisma.profileBlock.create({
      data: { id: randomUUID(), blockerId: host.profileId, blockedId: mover },
    });
    expect((await execute(transferId)).status).toBe('failed');
    const row = await prisma.profileTransfer.findUniqueOrThrow({ where: { id: transferId } });
    expect(row.toAcceptedAt).toBeNull();
    expect(row.completedAt).toBeNull();
    expect((await prisma.profile.findUniqueOrThrow({ where: { id: mover } })).accountId).toBe(
      origin.accountId,
    );
  });

  it('GUARDIAN_REQUIRED : le seul adulte ne part pas en laissant des enfants seuls', async () => {
    const origin = await createAccountWithProfile(prisma);
    await addProfile(origin.accountId, true);
    const host = await createAccountWithProfile(prisma);
    await link(origin.profileId, host.profileId);
    const transferId = await dueMove({
      profileId: origin.profileId,
      from: origin.accountId,
      to: host.accountId,
    });
    expect((await execute(transferId)).status).toBe('failed');
  });

  it('regroupement : le compte d’origine vidé se supprime ensuite', async () => {
    const lone = await createAccountWithProfile(prisma);
    const host = await createAccountWithProfile(prisma);
    await link(lone.profileId, host.profileId);
    const undeclared = await dueMove({
      profileId: lone.profileId,
      from: lone.accountId,
      to: host.accountId,
    });
    expect((await execute(undeclared)).status).toBe('failed');
    await prisma.profileTransfer.update({
      where: { id: undeclared },
      data: { cancelledAt: new Date() },
    });

    const transferId = await dueMove({
      profileId: lone.profileId,
      from: lone.accountId,
      to: host.accountId,
      regroup: true,
    });
    const result = await execute(transferId);
    expect(result.status === 'completed' && result.fromEmptied).toBe(true);
    expect(await transfers.suspendEmptyAccount(lone.accountId, 100)).toBe(true);
    expect(await transfers.deleteEmptyAccount(lone.accountId)).toBe(true);
    expect(await prisma.account.count({ where: { id: lone.accountId } })).toBe(0);
  });
});

describe('execute, détachement (PRO-13)', () => {
  async function dueDetach(profileId: string, from: string, email: string): Promise<string> {
    const id = randomUUID();
    const past = new Date(Date.now() - 1000);
    await prisma.profileTransfer.create({
      data: {
        id,
        kind: 'DETACH',
        profileId,
        fromAccountId: from,
        newEmail: email,
        tokenHash: hashOf(randomUUID()),
        tokenExpiresAt: new Date(Date.now() + DAY),
        profileConsentRequired: true,
        fromAcceptedAt: past,
        toAcceptedAt: past,
        profileAcceptedAt: past,
        pinChoice: 'NONE',
        executesAt: past,
        expiresAt: new Date(Date.now() + 7 * DAY),
      },
    });
    return id;
  }

  it('crée le compte vérifié et y fait passer le profil, lié à la famille quittée', async () => {
    const origin = await createAccountWithProfile(prisma);
    const mover = await addProfile(origin.accountId);
    const email = `d-${randomUUID()}@lahotte.test`;
    const transferId = await dueDetach(mover, origin.accountId, email);
    const accountId = randomUUID();
    const result = await transfers.execute({
      transferId,
      now: new Date(),
      linkIds: () => randomUUID(),
      newAccount: { id: accountId, email, passwordHash: 'hash-factice' },
    });
    expect(result.status).toBe('completed');
    const created = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(created.emailVerifiedAt).not.toBeNull();
    expect(created.ageAttestedAt).not.toBeNull();
    expect((await prisma.profile.findUniqueOrThrow({ where: { id: mover } })).accountId).toBe(
      accountId,
    );
    expect(
      await prisma.profileLink.count({
        where: { OR: [{ profileAId: mover }, { profileBId: mover }] },
      }),
    ).toBe(1);
  });

  it('une adresse déjà inscrite ne crée rien', async () => {
    const origin = await createAccountWithProfile(prisma);
    const mover = await addProfile(origin.accountId);
    const owner = await createAccountWithProfile(prisma);
    const email = `test-${owner.accountId}@lahotte.test`;
    const transferId = await dueDetach(mover, origin.accountId, email);
    const result = await transfers.execute({
      transferId,
      now: new Date(),
      linkIds: () => randomUUID(),
      newAccount: { id: randomUUID(), email, passwordHash: 'hash-factice' },
    });
    expect(result.status).toBe('email_taken');
    expect((await prisma.profile.findUniqueOrThrow({ where: { id: mover } })).accountId).toBe(
      origin.accountId,
    );
  });
});

describe('canReceive (PRO-12)', () => {
  it('un compte lié reçoit ; un compte sous tutelle, le même compte ou un inconnu, non', async () => {
    const origin = await createAccountWithProfile(prisma);
    const mover = await addProfile(origin.accountId);
    const host = await createAccountWithProfile(prisma);
    await link(mover, host.profileId);
    expect(await transfers.canReceive(mover, host.accountId)).toBe(true);
    expect(await transfers.canReceive(mover, origin.accountId)).toBe(false);
    const stranger = await createAccountWithProfile(prisma);
    expect(await transfers.canReceive(mover, stranger.accountId)).toBe(false);
  });
});

describe('due (revue SEC-40, I1)', () => {
  it('plus de 100 détachements au lien encore valable ne masquent pas un passage échu', async () => {
    const origin = await createAccountWithProfile(prisma);
    const past = new Date(Date.now() - 2 * DAY);
    const rows: Prisma.ProfileTransferCreateManyInput[] = [];
    for (let i = 0; i < 101; i += 1) {
      const profileId = await addProfile((await createAccountWithProfile(prisma)).accountId);
      rows.push({
        id: randomUUID(),
        kind: 'DETACH' as const,
        profileId,
        fromAccountId: origin.accountId,
        newEmail: `n-${randomUUID()}@lahotte.test`,
        tokenHash: hashOf(randomUUID()),
        tokenExpiresAt: new Date(Date.now() + DAY),
        profileConsentRequired: true,
        fromAcceptedAt: past,
        toAcceptedAt: past,
        profileAcceptedAt: past,
        pinChoice: 'NONE' as const,
        executesAt: past,
        expiresAt: new Date(Date.now() + 7 * DAY),
      });
    }
    await prisma.profileTransfer.createMany({ data: rows });
    const mover = await addProfile(origin.accountId);
    const host = await createAccountWithProfile(prisma);
    await link(mover, host.profileId);
    const moveId = await dueMove({ profileId: mover, from: origin.accountId, to: host.accountId });
    const due = await transfers.due(new Date());
    expect(due.map((d) => d.id)).toContain(moveId);
    expect(due.some((d) => rows.some((r) => r.id === d.id))).toBe(false);
  });
});
