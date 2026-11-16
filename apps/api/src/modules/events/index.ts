// Seule surface importable par les autres modules (QA-03).
export { EventsModule } from './events.module';
/** Accès d'un profil à un événement, décidé par le moteur (ADR 0018). */
export { EventAccessReader } from './application/event-access-reader';
