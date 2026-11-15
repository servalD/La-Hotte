// Réservé aux tests : jetons des ports et doubles en mémoire.
export { ImageStore, ProductRepository } from './domain/product.ports';
export { PageFetcher } from './domain/page-fetcher.port';
export {
  FakePageFetcher,
  InMemoryImageStore,
  InMemoryProductRepository,
} from './infrastructure/in-memory-catalog';
