import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { parseAdminCommand, runAdminCommand } from '../../src/cli/admin-command';

// RBAC-03, RBAC-07, ADM-07, AUD-05 : commande d'exploitation du premier administrateur.

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const deps = () => ({ now: new Date(), newId: () => randomUUID() });

afterAll(async () => {
  await prisma.$disconnect();
});

async function account(input: { totp: boolean }): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `op-${id}@lahotte.test`;
  await prisma.account.create({
    data: {
      id,
      email,
      emailVerifiedAt: new Date(),
      ageAttestedAt: new Date(),
      ...(input.totp
        ? { totpSecretEnc: Buffer.from('secret-chiffre'), totpEnabledAt: new Date() }
        : {}),
    },
  });
  return { id, email };
}

describe('Commande d’exploitation (RBAC-03, ADM-07)', () => {
  it('lit la ligne de commande sans accepter n’importe quoi', () => {
    expect(parseAdminCommand(['grant', ' Ana@Example.org '])).toEqual({
      kind: 'grant',
      email: 'ana@example.org',
    });
    expect(parseAdminCommand(['grant'])).toBeNull();
    expect(parseAdminCommand(['grant', 'a@b.c', 'en-trop'])).toBeNull();
    expect(parseAdminCommand(['delete', 'a@b.c'])).toBeNull();
    expect(parseAdminCommand(['grant', 'pas-une-adresse'])).toBeNull();
  });

  it('refuse un compte sans TOTP actif (AUTH-13, RBAC-07)', async () => {
    const { id, email } = await account({ totp: false });
    const result = await runAdminCommand(prisma, { kind: 'grant', email }, deps());
    expect(result.outcome).toBe('requirements_not_met');
    expect((await prisma.account.findUniqueOrThrow({ where: { id } })).role).toBe('USER');
  });

  it('donne ADMIN, coupe les sessions par l’époque et journalise sans acteur (AUD-05)', async () => {
    const { id, email } = await account({ totp: true });
    const before = await prisma.account.findUniqueOrThrow({ where: { id } });
    // ADM-07 : un lien de réinitialisation du TOTP ouvert avant l'attribution ne sert plus après.
    const tokenHash = randomUUID().replace(/-/g, '').padEnd(64, '0');
    await prisma.accountToken.create({
      data: {
        id: randomUUID(),
        accountId: id,
        purpose: 'TOTP_RESET',
        tokenHash,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    const result = await runAdminCommand(prisma, { kind: 'grant', email }, deps());
    expect(result).toEqual({ outcome: 'granted', accountId: id, epoch: before.authEpoch + 2 });
    const after = await prisma.account.findUniqueOrThrow({ where: { id } });
    expect(after.role).toBe('ADMIN');
    expect((await prisma.accountToken.findFirstOrThrow({ where: { tokenHash } })).usedAt).not.toBe(
      null,
    );
    const audit = await prisma.auditLog.findMany({ where: { targetId: id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorAccountId: null,
      action: 'role.grant_by_operator',
      targetKind: 'ACCOUNT',
    });
    expect((await runAdminCommand(prisma, { kind: 'grant', email }, deps())).outcome).toBe(
      'already_admin',
    );
  });

  it('recover retire le TOTP et le rôle, puis grant le rend après réactivation', async () => {
    const { id, email } = await account({ totp: true });
    await runAdminCommand(prisma, { kind: 'grant', email }, deps());
    const result = await runAdminCommand(prisma, { kind: 'recover', email }, deps());
    expect(result.outcome).toBe('recovered');
    const after = await prisma.account.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({ role: 'USER', totpSecretEnc: null, totpEnabledAt: null });
    const actions = (await prisma.auditLog.findMany({ where: { targetId: id } })).map(
      (row) => row.action,
    );
    expect(actions.sort()).toEqual(
      ['account.totp_reset_completed', 'role.grant_by_operator', 'role.revoke'].sort(),
    );
  });

  it('adresse inconnue : rien n’est écrit', async () => {
    const result = await runAdminCommand(
      prisma,
      { kind: 'grant', email: `absent-${randomUUID()}@lahotte.test` },
      deps(),
    );
    expect(result).toEqual({ outcome: 'account_not_found' });
  });
});
