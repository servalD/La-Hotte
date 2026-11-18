// Seule surface importable par les autres modules (QA-03). Doubles de test : `./testing`.
export { ListsModule } from './lists.module';
export { ProductReferences } from './application/product-references';
/** EVT-36 : wishlist rattachée créée à la réponse `Participe` (module `events`). */
export { EventWishlists } from './application/manage-event-lists.use-case';
/** Accès d'un profil à un élément et à ses fils, décidé par le moteur (ADR 0018). */
export {
  type AccountingItem,
  type ItemAccessContext,
  ItemAccessReader,
  type ItemSummary,
} from './application/item-access-reader';
/** CPT-44 : destinataires d'un événement que le lecteur voit en offreur (EVT-37). */
export { GetEventProgress } from './application/event-progress.use-case';
/** RGPD-11 : lectures du profil, à travers le moteur, pour son export. */
export { ListItems, ListLists } from './application/contract';
/** RGPD-11 : mêmes vues que l'API, champ par champ, pour l'export. */
export { toItemView, toListView } from './presentation/mappers';
