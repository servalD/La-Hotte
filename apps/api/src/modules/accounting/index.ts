// Seule surface importable par les autres modules (QA-03). Doubles de test : `./testing`.
export { AccountingModule } from './accounting.module';
/** RGPD-11 : panier, comptes et budgets du profil, pour son export. */
export { GetBalances, GetCart, ManageBudgets } from './application/contract';
/** RGPD-11 : mêmes vues que l'API, champ par champ, pour l'export. */
export { toCartView } from './presentation/purchase.controller';
export { toBalancesView, toBudgetView } from './presentation/settlement.controller';
