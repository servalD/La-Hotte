// Réservé aux tests : jetons des ports et doubles en mémoire.
export { AccountingPeople, AccountingRepository } from './domain/accounting.ports';
export {
  InMemoryAccountingPeople,
  InMemoryAccountingRepository,
} from './infrastructure/in-memory-accounting';
