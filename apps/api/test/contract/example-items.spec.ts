import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import type { InMemoryExampleItemRepository } from '../../src/modules/example';

// Contrat de la route d'exemple : nominal, validation, introuvable, forme des erreurs.
// « Non connecté » et « interdit » arrivent avec la session (phase 1).

let app: INestApplication;
let exampleItems: InMemoryExampleItemRepository;

beforeAll(async () => {
  ({ app, exampleItems } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

const PROBLEM = /application\/problem\+json/;

describe('POST /api/v1/example-items', () => {
  it('crée l’élément et renvoie la vue destinataire (201)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/example-items')
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
      .send({ title: 'x'.repeat(121), priority: 'urgent' })
      .expect(400);

    const fields = (res.body.errors as { field: string }[]).map((e) => e.field).sort();
    expect(fields).toEqual(['priority', 'title']);
  });

  it('API-13 : une règle métier non respectée donne 422 avec un code stable', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/example-items')
      .send({ title: '   ' })
      .expect(422);

    expect(res.body).toMatchObject({ code: 'EXAMPLE_TITLE_INVALID', status: 422 });
  });
});

describe('GET /api/v1/example-items/:id', () => {
  it('VIS-20 : le lecteur de phase 0 reçoit la vue destinataire, sans champ d’offreur', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/example-items')
      .send({ title: 'Livre' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/example-items/${created.body.id as string}`)
      .expect(200);

    expect(res.body.view).toBe('recipient');
    expect(res.body).not.toHaveProperty('reservation');
  });

  it('SEC-04 : introuvable renvoie 404 problem+json', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/example-items/0190f3c2-0000-7000-8000-000000000000')
      .expect(404);

    expect(res.headers['content-type']).toMatch(PROBLEM);
    expect(res.body).toMatchObject({ code: 'EXAMPLE_ITEM_NOT_FOUND' });
  });

  it('identifiant mal formé : 400', async () => {
    await request(app.getHttpServer()).get('/api/v1/example-items/pas-un-uuid').expect(400);
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

  it('OBS-01 : identifiant de requête propagé', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'abcdef12-3456')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('abcdef12-3456');
  });

  it('SEC-13 : en-têtes de sécurité', async () => {
    const res = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['strict-transport-security']).toContain('preload');
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
