// Réservé aux tests : jetons des ports et doubles en mémoire.
export { ImageStore, ProductRepository } from './domain/product.ports';
export { PageFetcher } from './domain/page-fetcher.port';
export { ExtractionCache, ExtractionQueue, ProductExtractor } from './domain/extraction.ports';
export { RunExtraction } from './application/extract-product.use-case';
export {
  FakePageFetcher,
  FakeProductExtractor,
  InMemoryExtractionCache,
  InMemoryImageStore,
  InMemoryProductRepository,
  ManualExtractionQueue,
} from './infrastructure/in-memory-catalog';
