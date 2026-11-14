import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { IdentityTestRoutesController } from '../contract/identity-test-routes.controller';
import { createAccountWithProfile, signIn } from '../support/sign-in';

// ADR 0013, « Adresse IP du client » : `trust proxy` réglé sur un nombre de sauts. Un
// `X-Forwarded-For` forgé par le client ne choisit pas l'adresse retenue (SEC-30, AUTH-07).
// Application réelle (bootstrap, PostgreSQL, Redis).

async function start(hops: string): Promise<INestApplication> {
  const previous = process.env.TRUSTED_PROXY_HOPS;
  process.env.TRUSTED_PROXY_HOPS = hops;
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [IdentityTestRoutesController],
    }).compile();
    const app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    return app;
  } finally {
    if (previous === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = previous;
  }
}

async function clientIp(app: INestApplication, xff?: string): Promise<string> {
  const user = await signIn(app, await createAccountWithProfile(app.get(PrismaService)));
  const call = request(app.getHttpServer())
    .get('/api/v1/_identity-test/client')
    .set('Cookie', user.cookie);
  if (xff !== undefined) call.set('X-Forwarded-For', xff);
  const res = await call.expect(200);
  return res.body.ip as string;
}

describe('TRUSTED_PROXY_HOPS=1 (production, derrière Caddy)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await start('1');
  });
  afterAll(async () => {
    await app.close();
  });

  it('retient l’adresse ajoutée par le mandataire, pas celle forgée par le client', async () => {
    // Le client envoie « 6.6.6.6 », Caddy ajoute l'adresse réelle « 203.0.113.7 ».
    expect(await clientIp(app, '6.6.6.6, 203.0.113.7')).toBe('203.0.113.7');
    expect(await clientIp(app, '1.1.1.1, 6.6.6.6, 203.0.113.7')).toBe('203.0.113.7');
  });
});

describe('TRUSTED_PROXY_HOPS=0 (aucun mandataire)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await start('0');
  });
  afterAll(async () => {
    await app.close();
  });

  it('X-Forwarded-For ignoré : adresse de la connexion', async () => {
    const ip = await clientIp(app, '6.6.6.6');
    expect(ip).not.toBe('6.6.6.6');
    expect(ip).toMatch(/127\.0\.0\.1|::1/);
  });
});
