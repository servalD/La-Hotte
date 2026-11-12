import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { ExampleItemRepository, InMemoryExampleItemRepository } from '../../src/modules/example';

/** Application montée avec ses vrais réglages (filtre, validation, en-têtes), ports en mémoire. */
export async function createTestApp(): Promise<{
  app: INestApplication;
  exampleItems: InMemoryExampleItemRepository;
}> {
  const exampleItems = new InMemoryExampleItemRepository();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ExampleItemRepository)
    .useValue(exampleItems)
    .compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  return { app, exampleItems };
}
