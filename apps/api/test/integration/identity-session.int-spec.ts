import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { ResolveSession } from '../../src/modules/identity/application/resolve-session.use-case';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import { SessionStore } from '../../src/modules/identity/domain/ports';
import { RedisSessionStore } from '../../src/modules/identity/infrastructure/redis-session-store';
import type { AppConfig } from '../../src/platform/config/env';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { RedisService } from '../../src/platform/redis/redis.service';
import { createAccountWithProfile, signIn, unlockProfile } from '../support/sign-in';

// ADR 0013 contre PostgreSQL et Redis réels : courses, pannes, rotation, réhydratation, époque,
// contraintes de base (DAT-01, DAT-02).

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;
let store: SessionStore;
let resolve: ResolveSession;
let lifecycle: SessionLifecycle;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
  store = app.get(SessionStore);
  resolve = app.get(ResolveSession);
  lifecycle = app.get(SessionLifecycle);
});

afterAll(async () => {
  await app.close();
});

const sess = (hash: string): string => `sess:${hash}`;
const http = () => request(app.getHttpServer());

describe('RedisSessionStore (ADR 0013)', () => {
  it('écrit la ligne puis le cache ; ni jeton ni e-mail dans Redis', async () => {
    const { accountId, profileId } = await createAccountWithProfile(prisma);
    const user = await signIn(app, { accountId, profileId });

    const row = await prisma.session.findUnique({ where: { id: user.sessionId } });
    expect(row?.tokenHash).toBe(user.tokenHash);
    const cached = await redis.client.get(sess(user.tokenHash));
    expect(cached).not.toBeNull();
    expect(cached).not.toContain(user.token);
    expect(cached).not.toContain('@lahotte.test');
    expect(await redis.client.sismember(`acct-sess:${accountId}`, user.tokenHash)).toBe(1);
  });

  it('critère de 01 : arrêt entre la marque et la suppression — la marque suffit', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const user = await signIn(app, { accountId });
    // Étape 1 seule de la révocation : la ligne et le cache sont encore là.
    await redis.client.set(`sess-revoked:${user.tokenHash}`, '1', 'PX', 60_000);

    expect(await resolve.execute(user.token)).toBeNull();
    await redis.client.del(sess(user.tokenHash));
    expect(await resolve.execute(user.token)).toBeNull();
    // Aucune réhydratation : le cache n'a pas été réécrit.
    expect(await redis.client.exists(sess(user.tokenHash))).toBe(0);
  });

  it('course révocation / réhydratation : une marque posée après la lecture en base l’emporte', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const user = await signIn(app, { accountId });
    await redis.client.del(sess(user.tokenHash));

    // Lecture en base faite, puis révocation qui s'intercale avant l'écriture du cache.
    const found = await store.lookup(user.tokenHash);
    expect(found.kind).toBe('stored');
    await lifecycle.revoke({ id: user.sessionId, accountId, tokenHash: user.tokenHash });
    if (found.kind !== 'stored') return;
    expect(await store.rehydrate(found.record, new Date())).toBe(false);
    expect(await redis.client.exists(sess(user.tokenHash))).toBe(0);
    expect(await resolve.execute(user.token)).toBeNull();
  });

  it('révocation : marque de 90 jours, ligne supprimée, cache supprimé', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const user = await signIn(app, { accountId });
    await lifecycle.revoke({ id: user.sessionId, accountId, tokenHash: user.tokenHash });

    const ttl = await redis.client.pttl(`sess-revoked:${user.tokenHash}`);
    expect(ttl).toBeGreaterThan(89 * 24 * 3600 * 1000);
    expect(await prisma.session.count({ where: { id: user.sessionId } })).toBe(0);
    expect(await redis.client.exists(sess(user.tokenHash))).toBe(0);
  });

  it('rotation : ancien jeton refusé, même id sous le nouveau hash, profil reverrouillé', async () => {
    const { accountId, profileId } = await createAccountWithProfile(prisma, { pin: true });
    const user = await signIn(app, { accountId, profileId });
    await unlockProfile(app, user, new Date());

    const rotated = await lifecycle.rotate({
      id: user.sessionId,
      accountId,
      tokenHash: user.tokenHash,
    });
    expect(await resolve.execute(user.token)).toBeNull();
    const row = await prisma.session.findUnique({ where: { id: user.sessionId } });
    expect(row?.tokenHash).toBe(rotated.record.tokenHash);
    expect(row?.reauthAt).not.toBeNull();
    const after = await resolve.execute(rotated.token);
    expect(after?.record.activeProfileId).toBe(profileId);
    expect(after?.unlock).toBeNull();
  });

  it('revue SEC-40 B1 : un rafraîchissement en vol n’annule pas un verrouillage (423 ensuite)', async () => {
    const { accountId, profileId } = await createAccountWithProfile(prisma, { pin: true });
    const user = await signIn(app, { accountId, profileId });
    await unlockProfile(app, user, new Date());
    // La requête en vol a lu ce déverrouillage…
    const seen = await resolve.execute(user.token);
    expect(seen?.unlock).not.toBeNull();
    // … le verrouillage passe…
    await lifecycle.lock({ id: user.sessionId, accountId, tokenHash: user.tokenHash }, profileId);
    // … puis elle veut prolonger : refusé, le profil reste verrouillé.
    if (!seen?.unlock) return;
    expect(await store.touchUnlock(user.tokenHash, seen.unlock, new Date())).toBe(false);
    await http()
      .get('/api/v1/session')
      .set('Cookie', user.cookie)
      .expect(200)
      .expect((res) => {
        expect(res.body.session.profileUnlocked).toBe(false);
      });
  });

  it('revue SEC-40 I1 : révocation concurrente d’une rotation, la session ne survit pas', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const user = await signIn(app, { accountId });
      const ref = { id: user.sessionId, accountId, tokenHash: user.tokenHash };
      const [rotated] = await Promise.allSettled([lifecycle.rotate(ref), lifecycle.revoke(ref)]);
      if (rotated.status === 'fulfilled') {
        expect(await resolve.execute(rotated.value.token)).toBeNull();
      }
      expect(await resolve.execute(user.token)).toBeNull();
      expect(await prisma.session.count({ where: { id: user.sessionId } })).toBe(0);
    }
  });

  it('revue SEC-40 I2 : cache sans ligne (Redis restauré) refusé à la recopie suivante', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const user = await signIn(app, { accountId });
    await prisma.session.delete({ where: { id: user.sessionId } });
    // Recopie due : on vieillit la dernière recopie du cache.
    await store.patchCache(user.tokenHash, { persistedAt: new Date(Date.now() - 6 * 60_000) });
    expect(await resolve.execute(user.token)).toBeNull();
    expect(await redis.client.exists(`sess-revoked:${user.tokenHash}`)).toBe(1);
  });

  it('réhydratation depuis PostgreSQL : profil actif gardé, verrouillé (423)', async () => {
    const { accountId, profileId } = await createAccountWithProfile(prisma, { pin: true });
    const user = await signIn(app, { accountId, profileId });
    await unlockProfile(app, user, new Date());
    await http().get('/api/v1/session').set('Cookie', user.cookie).expect(200);

    await redis.client.del(sess(user.tokenHash));
    const res = await http().get('/api/v1/session').set('Cookie', user.cookie).expect(200);
    expect(res.body.session).toMatchObject({ activeProfileId: profileId, profileUnlocked: false });
    expect(await redis.client.exists(sess(user.tokenHash))).toBe(1);
  });

  it('ADR 0014 : double incrément, une session ouverte pendant le changement est refusée après', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const before = await signIn(app, { accountId });
    const committed = await store.beginEpochChange(accountId);
    const during = await signIn(app, { accountId });
    // Transaction de l'appelant (tranche 2) : époque E+2 écrite avec le nouveau mot de passe.
    await prisma.account.update({ where: { id: accountId }, data: { authEpoch: committed } });
    await store.completeEpochChange(accountId, committed);

    expect(await resolve.execute(before.token)).toBeNull();
    expect(await resolve.execute(during.token)).toBeNull();
    expect(await resolve.execute((await signIn(app, { accountId })).token)).not.toBeNull();
  });

  it('époque augmentée dans Redis, transaction jamais faite : tout refusé, reconnexion possible', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const a = await signIn(app, { accountId });
    const b = await signIn(app, { accountId });
    await redis.client.del(sess(b.tokenHash));

    await store.beginEpochChange(accountId);
    expect(await resolve.execute(a.token)).toBeNull();
    expect(await resolve.execute(b.token)).toBeNull();

    const again = await signIn(app, { accountId });
    expect(await resolve.execute(again.token)).not.toBeNull();
    // La base a été rattrapée vers l'avant.
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    expect(account?.authEpoch).toBe(Number(await redis.client.get(`acct-epoch:${accountId}`)));
  });

  it('AUTH-05 : révoquer tout part des lignes ; un cache orphelin reçoit aussi sa marque', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const keep = await signIn(app, { accountId });
    const other = await signIn(app, { accountId });
    const orphan = 'f'.repeat(64);
    await redis.client.sadd(`acct-sess:${accountId}`, orphan);
    await redis.client.set(sess(orphan), '{}', 'PX', 60_000);

    await lifecycle.revokeAll(accountId, keep.sessionId);
    expect(await resolve.execute(other.token)).toBeNull();
    expect(await resolve.execute(keep.token)).not.toBeNull();
    expect(await redis.client.exists(`sess-revoked:${orphan}`)).toBe(1);
    expect(await redis.client.exists(sess(orphan))).toBe(0);
  });

  it('revue SEC-40 (cycle 2, 1) : PostgreSQL en panne, la marque est posée quand même', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const user = await signIn(app, { accountId });
    const deadDb = new PrismaClient({ datasourceUrl: 'postgresql://x:x@127.0.0.1:1/x' });
    const broken = new RedisSessionStore(deadDb as unknown as PrismaService, redis);
    try {
      await expect(
        broken.revoke({ id: user.sessionId, accountId, tokenHash: user.tokenHash }),
      ).rejects.toThrow();
    } finally {
      await deadDb.$disconnect();
    }
    expect(await redis.client.exists(`sess-revoked:${user.tokenHash}`)).toBe(1);
    expect(await resolve.execute(user.token)).toBeNull();
  });

  it('revue SEC-40 (cycle 2, 2) : une révocation ne touche jamais la session d’un autre compte', async () => {
    const victim = await createAccountWithProfile(prisma);
    const other = await createAccountWithProfile(prisma);
    const user = await signIn(app, { accountId: victim.accountId });
    await lifecycle.revoke({
      id: user.sessionId,
      accountId: other.accountId,
      tokenHash: 'e'.repeat(64),
    });
    expect(await prisma.session.count({ where: { id: user.sessionId } })).toBe(1);
    expect(await resolve.execute(user.token)).not.toBeNull();
  });

  it('revue SEC-40 (cycle 2, 3) : refus d’un ancien jeton à la recopie, la session tournée vit', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    const user = await signIn(app, { accountId });
    const ref = { id: user.sessionId, accountId, tokenHash: user.tokenHash };
    const rotated = await lifecycle.rotate(ref);
    await lifecycle.revokeToken(ref);
    expect(await resolve.execute(rotated.token)).not.toBeNull();
    expect(await resolve.execute(user.token)).toBeNull();
  });

  it('Redis indisponible : 503 en échec fermé, jamais une session acceptée', async () => {
    const config = { env: { REDIS_URL: 'redis://127.0.0.1:1' } } as AppConfig;
    const down = new RedisService(config);
    const broken = new RedisSessionStore(prisma, down);
    await expect(broken.lookup('0'.repeat(64))).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    await expect(
      broken.revoke({
        id: '0190f3c2-0000-7000-8000-000000000000',
        accountId: 'x',
        tokenHash: '0'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    down.onModuleDestroy();
  });
});

describe('Contraintes de base (DAT-01, DAT-02)', () => {
  it('ADR 0013 : session.account_id en RESTRICT, un compte avec session ne se supprime pas', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    await signIn(app, { accountId });
    await expect(prisma.account.delete({ where: { id: accountId } })).rejects.toThrow();
  });

  it('DAT-01 : e-mail normalisé, hash de jeton au bon format, 10 profils au plus', async () => {
    const { accountId } = await createAccountWithProfile(prisma);
    await expect(
      prisma.account.update({
        where: { id: accountId },
        data: { email: 'Majuscule@Lahotte.test' },
      }),
    ).rejects.toThrow();

    const base = {
      accountId,
      displayName: 'P',
      accentColor: '#000000',
      locale: 'fr',
      currency: 'EUR',
      timezone: 'Europe/Paris',
    };
    for (let i = 0; i < 9; i += 1) {
      await prisma.profile.create({ data: { ...base, id: crypto.randomUUID() } });
    }
    await expect(
      prisma.profile.create({ data: { ...base, id: crypto.randomUUID() } }),
    ).rejects.toThrow(/profile limit|profile_limit_per_account/);
  });

  it('SEC-03 : le profil actif d’une session appartient à son compte, des deux côtés', async () => {
    const mine = await createAccountWithProfile(prisma);
    const theirs = await createAccountWithProfile(prisma);
    const user = await signIn(app, { accountId: mine.accountId, profileId: mine.profileId });
    await expect(
      prisma.session.update({
        where: { id: user.sessionId },
        data: { activeProfileId: theirs.profileId },
      }),
    ).rejects.toThrow(/session_active_profile_same_account|another account/);
    await expect(
      prisma.profile.update({
        where: { id: mine.profileId },
        data: { accountId: theirs.accountId },
      }),
    ).rejects.toThrow(/profile_account_matches_sessions|another account/);
  });

  it('DAT-02 : le rôle applicatif ne peut ni modifier ni supprimer le journal de sécurité', async () => {
    // Connexion avec le rôle applicatif (DATABASE_URL), comme l'application.
    const appRole = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    try {
      const id = crypto.randomUUID();
      await appRole.securityLog.create({
        data: { id, event: 'csrf.rejected', ip: '203.0.113.7', userAgent: 'ua' },
      });
      await expect(
        appRole.$executeRaw(
          Prisma.sql`UPDATE security_log SET event = 'session.revoked' WHERE id = ${id}::uuid`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        appRole.$executeRaw(Prisma.sql`DELETE FROM security_log WHERE id = ${id}::uuid`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await appRole.$disconnect();
    }
  });
});

describe('Santé (ADR 0013)', () => {
  it('/health/ready vérifie que Redis est en noeviction', async () => {
    const res = await http().get('/health/ready').expect(200);
    expect(res.body.checks).toMatchObject({ redisEviction: 'up' });
  });
});
