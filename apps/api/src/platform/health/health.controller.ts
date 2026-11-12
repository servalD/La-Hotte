import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
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
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: 'ok' | 'unavailable'; checks: Record<'database' | 'redis', CheckState> }> {
    const [database, redis] = await Promise.all([
      probe(() => this.prisma.$queryRaw`SELECT 1`),
      probe(() => this.redis.ping()),
    ]);
    const ok = database === 'up' && redis === 'up';
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'unavailable', checks: { database, redis } };
  }
}
