// Seule surface importable par les autres modules et par app.module (QA-03). Ni le magasin de
// sessions ni le cycle de vie n'en sortent : un autre module ne peut ni créer une session, ni
// déverrouiller un profil (un seul juge, invariant 2). Doubles de test : `./testing`.
export { IdentityModule } from './identity.module';

// Décorateurs de route et de paramètre (ADR 0013, « Chaîne de gardes »).
export {
  AccountScope,
  ActiveProfile,
  AdminScope,
  CurrentPlatformActor,
  activeProfileOf,
  ClientContext,
  type ClientContextValue,
  CurrentSession,
  OidcCallback,
  Public,
  RequiresProfile,
  RequiresRecentReauth,
} from './presentation/decorators';
export type { PlatformActor, PlatformPermission } from './application/contract';
/** Administration des comptes (ADM-06 à ADM-08, RBAC-07), pour le module `admin`. */
export {
  type AdminActionInput,
  ChangeAccountRole,
  ForceLogout,
  ReactivateAccount,
  RequestTotpReset,
  RestorePublication,
  SuspendAccount,
  SuspendPublication,
} from './application/contract';
export type { ActiveProfile as ActiveProfileValue } from './application/authorize-profile.use-case';

/**
 * Passerelle temps réel (phase 4) : `CheckSessionAccess.execute(sessionId, profileId)` à chaque
 * émission, et les événements `session.revoked`, `profile.locked`, `session.profile_changed`.
 */
export { CheckSessionAccess } from './application/check-session-access.use-case';
/** API-30, RT-01 : poignée de main de la passerelle (cookie de session, origine, profil actif). */
export { SocketAuthenticator, type SocketIdentity } from './presentation/socket-authenticator';

/**
 * Cercle d'un profil (LNK-09), lu en base à chaque appel : seul juge du cercle pour le futur module
 * `visibility` (invariant 2). `circle.changed` est publié à l'acceptation, la rupture et le blocage.
 */
export { CircleReader } from './domain/link.ports';

/** EVT-15 : e-mail neutre aux comptes des profils invités à un événement. */
export { EventInvitationNotices } from './application/event-invitation-notices';
/** NOT-15, NOT-17 : résumé e-mail au compte ; session encore vivante avant une push. */
export { CheckSessionAlive, DigestMailer } from './application/digest-mailer';
export { type IdentityEvent, IdentityEvents, type IdentityEventListener } from './domain/ports';
/** RGPD-11 : données du profil actif, pour son export. */
export { GetOwnProfile } from './application/contract';
/** SEC-30, RGPD-11 : journal de sécurité, pour la trace d'un export (sans contenu). */
export { SecurityLog } from './domain/ports';
