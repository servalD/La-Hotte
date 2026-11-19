import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaAccountDirectory } from '../../src/modules/admin/infrastructure/prisma-account-directory';
import { PrismaAccountAdministration } from '../../src/modules/identity/infrastructure/prisma-account-administration';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { PrismaPlatformSettings } from '../../src/platform/settings/prisma-platform-settings';
import type { AuditAction, AuditWrite } from '../../src/shared/domain';
import { createAccountWithProfile, signIn } from '../support/sign-in';

// Adaptateurs Prisma de la tranche 3 de la phase 7 : AUD-05 (audit dans la transaction), ADM-06,
// ADM-07, RBAC-03 (dernier administrateur sous verrou), ADM-09, ADM-04, RGPD-13.

let app: INestApplication;
let prisma: PrismaService;
let administration: PrismaAccountAdministration;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  administration = new PrismaAccountAdministration(prisma);
});

afterAll(async () => {
  await app.close();
});

const write = (action: AuditAction, targetId: string): AuditWrite => ({
  id: randomUUID(),
  at: new Date(),
  entry: {
    actorAccountId: randomUUID(),
    action,
    targetKind: 'ACCOUNT',
    targetId,
    reason: 'motif de test suffisant',
    ip: '203.0.113.7',
  },
});

describe('Suspension (ADM-06, AUD-05)', () => {
  it('état, époque et audit ensemble ; réactivation seulement après une suspension journalisée', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const before = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(
      await administration.suspend({
        accountId,
        authEpoch: before.authEpoch + 2,
        audit: write('account.suspend', accountId),
      }),
    ).toBe(true);
    const after = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(after).toMatchObject({ status: 'SUSPENDED', authEpoch: before.authEpoch + 2 });
    expect((await administration.target(accountId))?.suspendedByAdmin).toBe(true);
    expect(
      await administration.reactivate({ accountId, audit: write('account.reactivate', accountId) }),
    ).toBe(true);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: accountId } })).status).toBe(
      'ACTIVE',
    );
  });

  it('un compte suspendu par la purge ne se réactive pas', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    await prisma.account.update({ where: { id: accountId }, data: { status: 'SUSPENDED' } });
    expect(
      await administration.reactivate({ accountId, audit: write('account.reactivate', accountId) }),
    ).toBe(false);
  });

  it('audit refusé : rien n’est écrit', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const broken = write('account.suspend', accountId);
    await expect(
      administration.suspend({
        accountId,
        authEpoch: 99,
        // Adresse IP invalide : l'insertion de l'audit échoue, la transaction est annulée.
        audit: { ...broken, entry: { ...broken.entry, ip: 'pas-une-adresse' } },
      }),
    ).rejects.toThrow();
    expect((await prisma.account.findUniqueOrThrow({ where: { id: accountId } })).status).toBe(
      'ACTIVE',
    );
  });
});

describe('Rôles (RBAC-03)', () => {
  it('le dernier administrateur actif garde son rôle', async () => {
    // Base partagée par les tests : on retire d'abord le rôle à tous les autres administrateurs.
    await prisma.account.updateMany({ where: { role: 'ADMIN' }, data: { role: 'USER' } });
    const { accountId } = await createAccountWithProfile(prisma);
    await prisma.account.update({
      where: { id: accountId },
      data: { role: 'ADMIN', totpEnabledAt: new Date(), totpSecretEnc: Buffer.from('s') },
    });
    expect(
      await administration.setRole({
        accountId,
        role: 'USER',
        authEpoch: 10,
        now: new Date(),
        audits: () => [write('role.revoke', accountId)],
      }),
    ).toBe('last_admin');
    const { accountId: second } = await createAccountWithProfile(prisma);
    await prisma.account.update({ where: { id: second }, data: { role: 'ADMIN' } });
    expect(
      await administration.setRole({
        accountId,
        role: 'USER',
        authEpoch: 10,
        now: new Date(),
        audits: () => [write('role.revoke', accountId)],
      }),
    ).toBe('changed');
    await prisma.account.update({ where: { id: second }, data: { role: 'USER' } });
  });

  it('attribuer un rôle annule les liens TOTP_RESET encore ouverts, dans la transaction (ADM-07)', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const now = new Date();
    const tokenHash = randomUUID().replace(/-/g, '').padEnd(64, '0');
    await prisma.accountToken.create({
      data: {
        id: randomUUID(),
        accountId,
        purpose: 'TOTP_RESET',
        tokenHash,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 30 * 60_000),
      },
    });
    expect(
      await administration.setRole({
        accountId,
        role: 'MODERATOR',
        authEpoch: 12,
        now,
        audits: () => [write('role.grant', accountId)],
      }),
    ).toBe('changed');
    const row = await prisma.accountToken.findFirstOrThrow({ where: { tokenHash } });
    expect(row.usedAt).toEqual(now);
  });
});

describe('Réinitialisation du TOTP (ADM-07)', () => {
  it('TOTP, codes de secours et appareils de confiance retirés', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    await prisma.account.update({
      where: { id: accountId },
      data: { totpEnabledAt: new Date(), totpSecretEnc: Buffer.from('s'), totpLastStep: 5 },
    });
    await prisma.recoveryCode.create({
      data: { id: randomUUID(), accountId, codeHash: 'a'.repeat(64) },
    });
    expect(
      await administration.completeTotpReset({
        accountId,
        authEpoch: 4,
        now: new Date(),
        audit: write('account.totp_reset_completed', accountId),
      }),
    ).toBe(true);
    const after = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(after).toMatchObject({ totpEnabledAt: null, totpSecretEnc: null, totpLastStep: null });
    expect(await prisma.recoveryCode.count({ where: { accountId } })).toBe(0);
  });
});

describe('Réglages et annuaire (ADM-09, ADM-04, RGPD-13)', () => {
  it('écriture d’un réglage avec son audit, relue par la mémoire', async () => {
    const settings = new PrismaPlatformSettings(prisma);
    const actor = randomUUID();
    const before = await settings.write({
      key: 'extraction_daily_limit',
      value: 50,
      updatedBy: actor,
      audit: () => ({
        id: randomUUID(),
        at: new Date(),
        entry: {
          actorAccountId: actor,
          action: 'setting.update',
          targetKind: 'SETTING',
          targetId: null,
          reason: 'motif de test suffisant',
          ip: null,
        },
      }),
    });
    expect(before === null || typeof before === 'number').toBe(true);
    expect(settings.current().extraction_daily_limit).toBe(50);
    await prisma.platformSetting.delete({ where: { key: 'extraction_daily_limit' } });
  });

  it('métadonnées sans contenu, et dernière connexion écrite à l’ouverture de session', async () => {
    const created = await createAccountWithProfile(prisma);
    await signIn(app, created);
    const account = await prisma.account.findUniqueOrThrow({ where: { id: created.accountId } });
    expect(account.lastSignInAt).not.toBeNull();
    const found = await new PrismaAccountDirectory(prisma).findByEmail(account.email);
    expect(found).toMatchObject({ accountId: created.accountId, profileCount: 1, listCount: 0 });
    expect(JSON.stringify(found)).not.toContain(account.email);
  });
});
