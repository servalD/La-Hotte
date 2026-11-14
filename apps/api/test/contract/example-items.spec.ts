import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ExampleItem } from '../../src/modules/example/domain/example-item';
import { createTestApp } from './create-test-app';
import type { InMemoryExampleItemRepository } from '../../src/modules/example';
import type { SignedIn } from '../support/sign-in';

// Contrat de la route d'exemple : nominal, non connecté, verrouillé, validation, introuvable,
// forme des erreurs.

let app: INestApplication;
let exampleItems: InMemoryExampleItemRepository;
let user: SignedIn;
let locked: SignedIn;

beforeAll(async () => {
  let identity;
  ({ app, exampleItems, identity } = await createTestApp());
  user = await identity.signIn();
  locked = await identity.signIn({ pin: true });
});

afterAll(async () => {
  await app.close();
});

const PROBLEM = /application\/problem\+json/;

describe('POST /api/v1/example-items', () => {
  it('crée l’élément et renvoie la vue destinataire (201)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/example-items')
      .set(user.mutation)
      .send({ title: 'Vélo', priority: 'high' })
      .expect(201);

    expect(res.body).toEqual({
      view: 'recipient',
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      title: 'Vélo',
      priority: 'high',
    });
    expect(exampleItems.size).toBeGreaterThan(0);
  });

  it('SEC-10 / API-14 : champ inconnu rejeté en problem+json, valeur jamais renvoyée', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/example-items')
      .set(user.mutation)
      .send({ title: 'Vélo', isAdmin: 'valeur-piegee' })
      .expect(400);

    expect(res.headers['content-type']).toMatch(PROBLEM);
    expect(res.body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', type: 'about:blank' });
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'isAdmin' })]),
    );
    expect(JSON.stringify(res.body)).not.toContain('valeur-piegee');
  });

  it('API-04 : contraintes de longueur et d’énumération', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/example-items')
      .set(user.mutation)
      .send({ title: 'x'.repeat(121), priority: 'urgent' })
      .expect(400);

    const fields = (res.body.errors as { field: string }[]).map((e) => e.field).sort();
    expect(fields).toEqual(['priority', 'title']);
  });

  it('API-13 : une règle métier non respectée donne 422 avec un code stable', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/example-items')
      .set(user.mutation)
      .send({ title: '   ' })
      .expect(422);

    expect(res.body).toMatchObject({ code: 'EXAMPLE_TITLE_INVALID', status: 422 });
  });
});

describe('Session et profil (SEC-01, PIN-02)', () => {
  it('SEC-01 : sans session, 401 problem+json, en lecture comme en écriture', async () => {
    const read = await request(app.getHttpServer())
      .get('/api/v1/example-items/0190f3c2-0000-7000-8000-000000000000')
      .expect(401);
    expect(read.body).toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    await request(app.getHttpServer())
      .post('/api/v1/example-items')
      .set({ Origin: 'http://localhost:3000' })
      .send({ title: 'Vélo' })
      .expect(401);
  });

  it('PIN-02 : profil protégé non déverrouillé, 423 PROFILE_LOCKED', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/example-items')
      .set(locked.mutation)
      .send({ title: 'Vélo' })
      .expect(423);
    expect(res.body).toMatchObject({ code: 'PROFILE_LOCKED' });
  });
});

describe('GET /api/v1/example-items/:id', () => {
  it('VIS-20 : le profil actif, sans lien avec l’élément, reçoit la vue destinataire, sans champ d’offreur', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/example-items')
      .set(user.mutation)
      .send({ title: 'Livre' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/example-items/${created.body.id as string}`)
      .set('Cookie', user.cookie)
      .expect(200);

    expect(res.body.view).toBe('recipient');
    expect(res.body).not.toHaveProperty('reservation');
  });

  it('VIS-20 : élément réservé, aucune donnée d’offreur ne sort, sous aucun nom', async () => {
    const SENTINEL = 'SENTINELLE-OFFREUR';
    const id = '0190f3c2-0000-7000-8000-000000000042';
    await exampleItems.save(
      ExampleItem.restore({
        id,
        title: 'Vélo',
        priority: 'high',
        reservation: { byName: SENTINEL, at: new Date('2026-11-12T10:00:00Z') },
        version: 2,
        createdAt: new Date('2026-11-12T09:00:00Z'),
      }),
    );

    const res = await request(app.getHttpServer())
      .get(`/api/v1/example-items/${id}`)
      .set('Cookie', user.cookie)
      .expect(200);

    expect(Object.keys(res.body as object).sort()).toEqual(['id', 'priority', 'title', 'view']);
    expect(JSON.stringify(res.body)).not.toContain(SENTINEL);
    expect(res.text).not.toContain(SENTINEL);
    expect(res.text).not.toContain('2026-11-12T10:00:00');
  });

  it('SEC-04 : introuvable renvoie 404 problem+json', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/example-items/0190f3c2-0000-7000-8000-000000000000')
      .set('Cookie', user.cookie)
      .expect(404);

    expect(res.headers['content-type']).toMatch(PROBLEM);
    expect(res.body).toMatchObject({ code: 'EXAMPLE_ITEM_NOT_FOUND' });
  });

  it('identifiant mal formé : 400', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/example-items/pas-un-uuid')
      .set('Cookie', user.cookie)
      .expect(400);
  });
});

describe('Socle HTTP', () => {
  it('route inconnue : 404 problem+json sans détail interne', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Introuvable',
      status: 404,
      code: 'NOT_FOUND',
      requestId: expect.any(String),
    });
  });

  it('API-14 : un corps trop volumineux donne 413 problem+json, pas une erreur interne', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/example-items')
      .set(user.mutation)
      .send({ title: 'x'.repeat(200_000) })
      .expect(413);

    expect(res.headers['content-type']).toMatch(PROBLEM);
    expect(res.body).toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('API-14 : un JSON invalide donne 400 problem+json sans écho du contenu', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/example-items')
      .set(user.mutation)
      .set('Content-Type', 'application/json')
      .send('{"title": "valeur-piegee", ')
      .expect(400);

    expect(res.headers['content-type']).toMatch(PROBLEM);
    expect(res.body).toMatchObject({ status: 400, code: 'BAD_REQUEST' });
    expect(res.text).not.toContain('valeur-piegee');
  });

  it('OBS-01 : identifiant de requête propagé', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', '0190f3c2-0000-7000-8000-0000000000aa')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('0190f3c2-0000-7000-8000-0000000000aa');
  });

  it('OBS-01 : un identifiant de requête qui n’est pas un UUID est remplacé', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'texte-libre-du-client')
      .expect(200);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('SEC-13 : en-têtes de sécurité', async () => {
    const res = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['strict-transport-security']).toContain('preload');
    expect(res.headers['permissions-policy']).toContain('camera=()');
  });

  it('SEC-14 : CORS limité à l’origine de l’application web', async () => {
    const ok = await request(app.getHttpServer())
      .options('/api/v1/example-items')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    const ko = await request(app.getHttpServer())
      .options('/api/v1/example-items')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(ko.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('OBS-06 : /health/live répond hors du préfixe', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
  });
});
