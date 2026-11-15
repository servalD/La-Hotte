// Seule surface importable par les autres modules (QA-03). Doubles de test : `./testing`.
export { CatalogModule } from './catalog.module';
export { ProductCatalog } from './application/manage-products.use-case';
export type { Product, ShareLevel } from './domain/product';
export { ProductNotFoundError } from './domain/product.errors';
