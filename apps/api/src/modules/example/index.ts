// Seule surface importable par les autres modules et par app.module (QA-03).
export { ExampleModule } from './example.module';
export { ExampleItemRepository } from './domain/example-item.repository';
export { InMemoryExampleItemRepository } from './infrastructure/in-memory-example-item.repository';
