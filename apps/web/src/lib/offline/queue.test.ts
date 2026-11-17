// @vitest-environment node
import 'fake-indexeddb/auto';
import { ApiError } from '@wishlist/api-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { importCacheKey } from './crypto';
import { idbEntries, openDatabase, PROFILE_STORES } from './idb';
import {
  ActionQueue,
  backoff,
  QUEUE_MAX_AGE_MS,
  type QueuedInput,
  type QueuedStep,
  type StepSender,
} from './queue';
import { destroyProfileVault, profileDatabaseName, ProfileVault } from './vault';

// OFF-11 à OFF-19 (ADR 0020) : file d'actions, rejeu, réponses, cloisonnement.

const P1 = '0193f5a0-0000-7000-8000-000000000001';
const P2 = '0193f5a0-0000-7000-8000-000000000002';
const ITEM = '0193f5a0-0000-7000-8000-0000000000aa';

const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  new ApiError({ type: 'x', title: 'x', status, code, ...extra });

/** Serveur simulé : idempotent par clé (API-16), comme l'API. */
function fakeServer() {
  const responses = new Map<string, unknown>();
  const effects: { url: string; body: unknown }[] = [];
  const failures: (Error | 'ok')[] = [];
  const send: StepSender = (step: QueuedStep, body) => {
    const failure = failures.shift();
    // 'ok' : cet appel passe (pour faire échouer un appel suivant seulement).
    if (failure !== undefined && failure !== 'ok') return Promise.reject(failure);
    if (responses.has(step.key)) return Promise.resolve(responses.get(step.key));
    effects.push({ url: step.url, body });
    const response = { id: `r-${String(effects.length)}` };
    responses.set(step.key, response);
    return Promise.resolve(response);
  };
  return { send, effects, failures };
}

const comment: QueuedInput = {
  kind: 'comment.post',
  subject: { itemId: ITEM, thread: 'GIVERS' },
  display: { body: 'Je prends le vélo' },
  steps: [{ method: 'POST', url: `/api/v1/items/${ITEM}/comments`, body: { thread: 'GIVERS' } }],
};

const purchase: QueuedInput = {
  kind: 'purchase.put',
  subject: { itemId: ITEM },
  display: {},
  steps: [
    { method: 'PUT', url: `/api/v1/items/${ITEM}/purchase`, body: { actualTotalMinor: null } },
  ],
};

let clock = 1_000_000;
const now = () => clock;

beforeEach(async () => {
  clock = 1_000_000;
  await destroyProfileVault(P1);
  await destroyProfileVault(P2);
});

describe('Critère « une même action rejouée trois fois n’a d’effet qu’une fois »', () => {
  it('coupures successives puis succès : un seul effet ; l’action quitte la file', async () => {
    const server = fakeServer();
    const queue = new ActionQueue(P1, null, server.send, undefined, now);
    expect(await queue.perform(comment, false)).toEqual({ queued: true });
    // Trois essais : deux sans réponse (l'effet a pu avoir lieu), puis un qui aboutit.
    server.failures.push(new TypeError('Failed to fetch'));
    await queue.run();
    clock += backoff(1);
    server.failures.push(new TypeError('Failed to fetch'));
    await queue.run();
    clock += backoff(2);
    await queue.run();
    expect(server.effects).toHaveLength(1);
    expect(queue.snapshot()).toEqual([]);
  });

  it('en ligne, une coupure pendant l’envoi met l’action en file avec la même clé', async () => {
    const server = fakeServer();
    const queue = new ActionQueue(P1, null, server.send, undefined, now);
    server.failures.push(new TypeError('Failed to fetch'));
    expect(await queue.perform(comment, true)).toEqual({ queued: true });
    await queue.run();
    expect(server.effects).toHaveLength(1);
  });
});

describe('Réponses au rejeu (OFF-18)', () => {
  it('ordre gardé : une action en attente de nouvel essai bloque les suivantes', async () => {
    const server = fakeServer();
    const queue = new ActionQueue(P1, null, server.send, undefined, now);
    await queue.perform(purchase, false);
    clock += 1;
    await queue.perform(comment, false);
    server.failures.push(problem(503, 'UNAVAILABLE'));
    await queue.run();
    expect(server.effects).toHaveLength(0);
    expect(queue.snapshot().map((a) => a.attempts)).toEqual([1, 0]);
    clock += backoff(1);
    await queue.run();
    expect(server.effects.map((e) => e.url)).toEqual([
      `/api/v1/items/${ITEM}/purchase`,
      `/api/v1/items/${ITEM}/comments`,
    ]);
  });

  it('refus expliqué (OFF-15, OFF-13) : code et reste gardés, les suivantes partent', async () => {
    const server = fakeServer();
    const queue = new ActionQueue(P1, null, server.send, undefined, now);
    await queue.perform(
      {
        kind: 'contribution.put',
        subject: { itemId: ITEM },
        display: { amountMinor: 3_000 },
        steps: [
          { method: 'PUT', url: `/api/v1/items/${ITEM}/contribution`, body: { mode: 'FULL' } },
        ],
      },
      false,
    );
    clock += 1;
    await queue.perform(comment, false);
    server.failures.push(problem(409, 'CONTRIBUTION_EXCEEDS_REMAINING', { remainingMinor: 1_200 }));
    await queue.run();
    const [refused] = queue.snapshot();
    expect(refused?.state).toBe('refused');
    expect(refused?.outcome).toEqual({
      status: 409,
      code: 'CONTRIBUTION_EXCEEDS_REMAINING',
      remainingMinor: 1_200,
    });
    expect(server.effects).toHaveLength(1);
  });

  it('412 : conflit (OFF-14) ; 423 : attend le déverrouillage ; 401 : arrêt, file gardée', async () => {
    const server = fakeServer();
    const queue = new ActionQueue(P1, null, server.send, undefined, now);
    await queue.perform(comment, false);
    server.failures.push(problem(423, 'PROFILE_LOCKED'));
    await queue.run();
    expect(queue.snapshot()[0]).toMatchObject({ state: 'pending', attempts: 0 });
    server.failures.push(problem(401, 'SESSION_REQUIRED'));
    await queue.run();
    expect(queue.snapshot()[0]).toMatchObject({ state: 'pending', attempts: 0 });
    server.failures.push(problem(412, 'VERSION_MISMATCH'));
    await queue.run();
    expect(queue.snapshot()[0]?.state).toBe('conflict');
  });

  it('« Refaire » : nouvelle intention, nouvelles clés', async () => {
    const server = fakeServer();
    const queue = new ActionQueue(P1, null, server.send, undefined, now);
    await queue.perform(comment, false);
    const before = queue.snapshot()[0]?.steps[0]?.key;
    server.failures.push(problem(404, 'ITEM_NOT_FOUND'));
    await queue.run();
    const refused = queue.snapshot()[0];
    if (!refused) throw new Error('action absente');
    await queue.redo(refused.id);
    const again = queue.snapshot()[0];
    expect(again?.state).toBe('pending');
    expect(again?.steps[0]?.key).not.toBe(before);
  });

  it('OFF-19 : plus de 30 jours en file, l’action n’est plus rejouée', async () => {
    const server = fakeServer();
    const queue = new ActionQueue(P1, null, server.send, undefined, now);
    await queue.perform(comment, false);
    clock += QUEUE_MAX_AGE_MS + 1;
    await queue.run();
    expect(queue.snapshot()[0]?.state).toBe('expired');
    expect(server.effects).toHaveLength(0);
  });
});

describe('Action composée : souhait ajouté à la main (OFF-17)', () => {
  it('fiche créée, coupure, puis élément ajouté avec l’identifiant de la fiche', async () => {
    const server = fakeServer();
    const queue = new ActionQueue(P1, null, server.send, undefined, now);
    await queue.perform(
      {
        kind: 'item.add',
        subject: { listId: 'liste' },
        display: { title: 'Casque' },
        steps: [
          { method: 'POST', url: '/api/v1/products', body: { title: 'Casque' } },
          {
            method: 'POST',
            url: '/api/v1/lists/liste/items',
            body: {},
            productIdFromPrevious: true,
          },
        ],
      },
      false,
    );
    server.failures.push('ok', new TypeError('Failed to fetch'));
    await queue.run();
    // La première étape a abouti ; la seconde n'a pas eu de réponse.
    expect(server.effects).toHaveLength(1);
    expect(queue.snapshot()[0]?.done).toBe(1);
    clock += backoff(1);
    await queue.run();
    expect(server.effects).toHaveLength(2);
    expect(server.effects[1]?.body).toEqual({ productId: 'r-1' });
  });
});

describe('Cloisonnement de la file (OFF-11, OFF-18, OFF-21)', () => {
  it('jamais rejouée sous un autre profil ; chiffrée dans le coffre d’un profil à PIN', async () => {
    const key = await importCacheKey(Buffer.alloc(32, 3).toString('base64url'));
    const vault = await ProfileVault.open(P1, key);
    const server = fakeServer();
    const mine = new ActionQueue(P1, vault, server.send, undefined, now);
    await mine.perform(comment, false);
    vault.close();

    const db = await openDatabase(profileDatabaseName(P1), PROFILE_STORES);
    const raw = JSON.stringify(
      (await idbEntries(db, 'queue')).map((r) =>
        Buffer.from((r.value as { data: ArrayBuffer }).data).toString('latin1'),
      ),
    );
    db.close();
    expect(raw).not.toContain('vélo');
    expect(raw).not.toContain('comments');

    // Un autre profil qui ouvrirait ce coffre (sans sa clé) n'y lit aucune action.
    const stranger = await ProfileVault.open(P1, null);
    const other = new ActionQueue(P2, stranger, server.send, undefined, now);
    await other.load();
    expect(other.snapshot()).toEqual([]);
    stranger.close();

    const reopened = await ProfileVault.open(P1, key);
    const again = new ActionQueue(P1, reopened, server.send, undefined, now);
    await again.load();
    expect(again.snapshot()).toHaveLength(1);
    await again.run();
    expect(server.effects).toHaveLength(1);
    expect(again.snapshot()).toEqual([]);
    reopened.close();
  });
});
