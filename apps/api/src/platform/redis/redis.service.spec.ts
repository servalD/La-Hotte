import { EventEmitter } from 'node:events';
import type { AppConfig } from '../config/env';
import { RedisService } from './redis.service';

// Robustesse Redis (ADR 0013) : refus rapide, jamais de promesse pendue ; CONFIG refusé ≠ panne.

function serviceWith(fake: object): RedisService {
  const service = new RedisService({
    env: { REDIS_URL: 'redis://127.0.0.1:1' },
  } as unknown as AppConfig);
  service.client.disconnect();
  Object.defineProperty(service, 'client', { value: fake });
  return service;
}

describe('RedisService.ready (ADR 0013)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reconnexion qui ne finit pas : refus au délai, et la tentative suivante repart', async () => {
    vi.useFakeTimers();
    const fake = Object.assign(new EventEmitter(), { status: 'reconnecting' });
    const service = serviceWith(fake);
    const first = service.ready();
    const rejected = expect(first).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3000);
    await rejected;
    expect(fake.listenerCount('ready')).toBe(0);
    expect(fake.listenerCount('close')).toBe(0);
    // Redis revient : l'appel suivant n'attend plus la promesse échouée.
    const second = service.ready();
    fake.status = 'ready';
    fake.emit('ready');
    await expect(second).resolves.toBe(fake);
  });

  it('fermeture de la connexion pendant l’attente : refus immédiat', async () => {
    const fake = Object.assign(new EventEmitter(), { status: 'reconnecting' });
    const service = serviceWith(fake);
    const pending = service.ready();
    fake.emit('close');
    await expect(pending).rejects.toThrow();
  });
});

describe('RedisService.evictionPolicy (ADR 0013)', () => {
  const ready = { status: 'ready' };

  it('CONFIG interdit (Redis géré) : null, pas une panne', async () => {
    const denied = Object.assign(new Error('NOPERM this user has no permissions'), {
      name: 'ReplyError',
    });
    const service = serviceWith({ ...ready, config: () => Promise.reject(denied) });
    await expect(service.evictionPolicy()).resolves.toBeNull();
  });

  it('autre erreur de réponse (LOADING) ou réponse vide : panne, pas un refus', async () => {
    const loading = Object.assign(new Error('LOADING Redis is loading'), { name: 'ReplyError' });
    await expect(
      serviceWith({ ...ready, config: () => Promise.reject(loading) }).evictionPolicy(),
    ).rejects.toThrow('LOADING');
    await expect(
      serviceWith({ ...ready, config: () => Promise.resolve([]) }).evictionPolicy(),
    ).rejects.toThrow();
  });

  it('panne de connexion : propagée', async () => {
    const service = serviceWith({ ...ready, config: () => Promise.reject(new Error('timeout')) });
    await expect(service.evictionPolicy()).rejects.toThrow('timeout');
  });

  it('lit la politique', async () => {
    const service = serviceWith({
      ...ready,
      config: () => Promise.resolve(['maxmemory-policy', 'noeviction']),
    });
    await expect(service.evictionPolicy()).resolves.toBe('noeviction');
  });
});
