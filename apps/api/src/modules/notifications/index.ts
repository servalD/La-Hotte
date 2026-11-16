// Seule surface importable par les autres modules (QA-03). Doubles de test : `./testing`.
export { NotificationsModule } from './notifications.module';
/** Push et résumé (tranche 6) et rattrapage temps réel lisent les notifications par ces ports. */
export {
  NotificationPeople,
  NotificationRepository,
  NotificationSubjects,
  PreferenceRepository,
} from './domain/notification.ports';
