import type { Response } from 'express';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { HealthController } from './health.controller';

// OBS-06, ADR 0013 : la sonde tombe sur une politique d'éviction autre que noeviction.

async function ready(
  policy: () => Promise<string | null>,
): Promise<{ code: number; body: unknown }> {
  let code = 0;
  const controller = new HealthController(
    { $queryRaw: () => Promise.resolve([1]) } as unknown as PrismaService,
    { ping: () => Promise.resolve(), evictionPolicy: policy } as unknown as RedisService,
  );
  const body = await controller.ready({
    status: (c: number) => {
      code = c;
    },
  } as unknown as Response);
  return { code, body };
}

describe('GET /health/ready, éviction Redis (ADR 0013)', () => {
  it('noeviction : 200', async () => {
    expect((await ready(() => Promise.resolve('noeviction'))).code).toBe(200);
  });

  it('volatile-lru : 503, redisEviction down', async () => {
    const res = await ready(() => Promise.resolve('volatile-lru'));
    expect(res.code).toBe(503);
    expect(res.body).toMatchObject({ checks: { redisEviction: 'down' } });
  });

  it('CONFIG interdit (null) : 200, vérifié au déploiement', async () => {
    expect((await ready(() => Promise.resolve(null))).code).toBe(200);
  });

  it('panne : 503', async () => {
    expect((await ready(() => Promise.reject(new Error('x')))).code).toBe(503);
  });
});
