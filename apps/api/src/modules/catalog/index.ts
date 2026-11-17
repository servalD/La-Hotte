// Seule surface importable par les autres modules (QA-03). Doubles de test : `./testing`.
export { CatalogModule } from './catalog.module';
export { ProductCatalog } from './application/manage-products.use-case';
export type { Product, ShareLevel } from './domain/product';
export { ProductNotFoundError } from './domain/product.errors';
/** CPT-62 : images privées (justificatif d'achat), servies par le module appelant. */
export { PrivateImages } from './application/private-images';
