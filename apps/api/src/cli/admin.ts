import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { parseAdminCommand, runAdminCommand } from './admin-command';

// RBAC-03, ADM-07 : `node dist/cli/admin.js grant|recover <email>` sur le serveur, avec
// DATABASE_URL et REDIS_URL de l'API. Sortie : un mot, jamais l'adresse (OBS-20).

const EPOCH = `
local current = tonumber(redis.call('GET', KEYS[1]) or '-1')
local value = math.max(current, tonumber(ARGV[1]))
if value ~= current then redis.call('SET', KEYS[1], value) end
return value`;

async function main(): Promise<number> {
  const command = parseAdminCommand(process.argv.slice(2));
  if (!command) {
    process.stderr.write('usage : admin grant|recover <email>\n');
    return 2;
  }
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!databaseUrl || !redisUrl) {
    process.stderr.write('DATABASE_URL et REDIS_URL sont requises\n');
    return 2;
  }
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    const result = await runAdminCommand(prisma, command, { now: new Date(), newId: uuidv7 });
    if (result.accountId && result.epoch !== undefined) {
      // ADR 0014 : l'époque de Redis rejoint celle de la base ; les sessions en cache tombent.
      await redis.connect();
      await redis.eval(EPOCH, 1, `acct-epoch:${result.accountId}`, String(result.epoch));
    }
    process.stdout.write(`${result.outcome}\n`);
    return result.outcome === 'granted' || result.outcome === 'recovered' ? 0 : 1;
  } finally {
    redis.disconnect();
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`échec : ${error instanceof Error ? error.name : 'erreur'}\n`);
    process.exit(1);
  },
);
