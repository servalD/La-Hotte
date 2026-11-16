// Réservé aux tests : jetons des ports et doubles en mémoire.
export {
  NotificationPeople,
  NotificationRepository,
  PreferenceRepository,
} from './domain/notification.ports';
export {
  InMemoryNotificationPeople,
  InMemoryNotificationRepository,
  InMemoryPreferenceRepository,
} from './infrastructure/in-memory-notifications';
