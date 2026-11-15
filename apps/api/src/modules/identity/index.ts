// Seule surface importable par les autres modules et par app.module (QA-03). Ni le magasin de
// sessions ni le cycle de vie n'en sortent : un autre module ne peut ni créer une session, ni
// déverrouiller un profil (un seul juge, invariant 2). Doubles de test : `./testing`.
export { IdentityModule } from './identity.module';

// Décorateurs de route et de paramètre (ADR 0013, « Chaîne de gardes »).
export {
  AccountScope,
  ActiveProfile,
  ClientContext,
  type ClientContextValue,
  CurrentSession,
  OidcCallback,
  Public,
  RequiresProfile,
  RequiresRecentReauth,
} from './presentation/decorators';
export type { ActiveProfile as ActiveProfileValue } from './application/authorize-profile.use-case';

/**
 * Passerelle temps réel (phase 4) : `CheckSessionAccess.execute(sessionId, profileId)` à chaque
 * émission, et les événements `session.revoked`, `profile.locked`, `session.profile_changed`.
 */
export { CheckSessionAccess } from './application/check-session-access.use-case';

/**
 * Cercle d'un profil (LNK-09), lu en base à chaque appel : seul juge du cercle pour le futur module
 * `visibility` (invariant 2). `circle.changed` est publié à l'acceptation, la rupture et le blocage.
 */
export { CircleReader } from './domain/link.ports';
export { type IdentityEvent, IdentityEvents, type IdentityEventListener } from './domain/ports';
