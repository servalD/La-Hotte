import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { ExampleItemRepository } from '../../src/modules/example';
import { PrismaService } from '../../src/platform/prisma/prisma.service';

// PostgreSQL et Redis réels. Migrations appliquées au préalable (pnpm db:migrate:deploy).

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  await prisma.exampleItem.deleteMany();
});

afterAll(async () => {
  await app.close();
});

describe('PrismaExampleItemRepository', () => {
  it('écrit et relit un élément par la route, à travers les quatre couches', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/example-items')
      .send({ title: 'Vélo', priority: 'low' })
      .expect(201);

    const repo = app.get(ExampleItemRepository);
    const item = await repo.findById(created.body.id as string);
    expect(item?.title).toBe('Vélo');
    expect(item?.priority).toBe('low');
    expect(item?.reservation).toBeNull();
  });

  it('DAT-03 : le rôle applicatif ne peut pas modifier le schéma', async () => {
    await expect(
      prisma.$executeRawUnsafe('CREATE TABLE should_not_exist (id int)'),
    ).rejects.toThrow();
  });
});

describe('DAT-02 droits du rôle applicatif', () => {
  it('ne peut ni modifier ni effacer l’historique des migrations', async () => {
    await expect(prisma.$executeRawUnsafe('DELETE FROM "_prisma_migrations"')).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "_prisma_migrations" SET logs = 'x'`),
    ).rejects.toThrow(/permission denied/i);
  });

  it('peut lire l’historique des migrations', async () => {
    await expect(
      prisma.$queryRaw`SELECT count(*) FROM "_prisma_migrations"`,
    ).resolves.toBeDefined();
  });
});

describe('OBS-06 /health/ready', () => {
  it('signale la base et Redis disponibles', async () => {
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200, { status: 'ok', checks: { database: 'up', redis: 'up' } });
  });
});
