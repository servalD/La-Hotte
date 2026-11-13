import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../modules/identity';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export type CheckState = 'up' | 'down';

const TIMEOUT_MS = 1500;

async function probe(run: () => Promise<unknown>): Promise<CheckState> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, TIMEOUT_MS);
  });
  try {
    await Promise.race([run(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

/** OBS-06. Hors du préfixe /api/v1 et du contrat : destiné à l'orchestrateur, pas au client. */
@ApiExcludeController()
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<{
    status: 'ok' | 'unavailable';
    checks: Record<'database' | 'redis' | 'redisEviction', CheckState>;
  }> {
    const [database, redis, redisEviction] = await Promise.all([
      probe(() => this.prisma.$queryRaw`SELECT 1`),
      probe(() => this.redis.ping()),
      // ADR 0013 : une marque de révocation ou un compteur évincés rouvriraient une faille.
      probe(async () => {
        if ((await this.redis.evictionPolicy()) !== 'noeviction') throw new Error('eviction');
      }),
    ]);
    const ok = database === 'up' && redis === 'up' && redisEviction === 'up';
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'unavailable', checks: { database, redis, redisEviction } };
  }
}
