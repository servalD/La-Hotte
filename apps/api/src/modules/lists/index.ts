// Seule surface importable par les autres modules (QA-03). Doubles de test : `./testing`.
export { ListsModule } from './lists.module';
export { ProductReferences } from './application/product-references';
/** EVT-36 : wishlist rattachée créée à la réponse `Participe` (module `events`). */
export { EventWishlists } from './application/manage-event-lists.use-case';
