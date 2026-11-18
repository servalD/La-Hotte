// Seule surface importable par les autres modules (QA-03). Doubles de test : `./testing`.
export { CatalogModule } from './catalog.module';
export { ProductCatalog } from './application/manage-products.use-case';
export type { ModerationStatus, Product, ShareLevel } from './domain/product';
export type { GlobalEntry, Publisher } from './domain/moderation';
export { ProductNotFoundError } from './domain/product.errors';
/** CPT-62 : images privées (justificatif d'achat), servies par le module appelant. */
export { PrivateImages } from './application/private-images';
/** RGPD-11 : fiches du profil, pour son export. */
export { ListOwnProducts } from './application/manage-products.use-case';
/** RGPD-11 : même vue que l'API, pour l'export. */
export { toProductView } from './presentation/products.controller';
