// Réservé aux tests : jetons des ports et doubles en mémoire.
export {
  AccountingPeople,
  AccountingRepository,
  BudgetRepository,
} from './domain/accounting.ports';
export {
  InMemoryAccountingPeople,
  InMemoryAccountingRepository,
  InMemoryBudgetRepository,
} from './infrastructure/in-memory-accounting';
