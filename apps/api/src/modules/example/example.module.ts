import { Module } from '@nestjs/common';
import { CreateExampleItem } from './application/create-example-item.use-case';
import { GetExampleItem } from './application/get-example-item.use-case';
import { ExampleItemRepository } from './domain/example-item.repository';
import { PrismaExampleItemRepository } from './infrastructure/prisma-example-item.repository';
import { ExampleItemsController } from './presentation/example-items.controller';

/** Câblage : le port du domaine est lié à son adaptateur d'infrastructure. */
@Module({
  controllers: [ExampleItemsController],
  providers: [
    CreateExampleItem,
    GetExampleItem,
    { provide: ExampleItemRepository, useClass: PrismaExampleItemRepository },
  ],
})
export class ExampleModule {}
