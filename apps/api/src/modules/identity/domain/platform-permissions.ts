import type { AccountRole } from './session';

/**
 * RBAC-02 : permissions de plateforme, portées par le rôle du compte (RBAC-01). Le tableau de la
 * spec est la source ; le test `platform-permissions.spec.ts` le recopie ligne à ligne.
 */
export const PLATFORM_PERMISSIONS = [
  'moderation.queue', // Voir la file de modération du catalogue
  'moderation.decide', // Retirer une fiche, traiter un signalement, suspendre la publication
  'stats.read', // Statistiques agrégées (STA-01)
  'accounts.search', // Rechercher un compte par e-mail (ADM-10)
  'accounts.manage', // Suspendre, réactiver, déconnecter, réinitialiser le TOTP (ADM-06 à ADM-08)
  'roles.manage', // Attribuer ou retirer un rôle (RBAC-03, RBAC-07)
  'audit.read', // Consulter le journal d'audit (AUD-06)
  'settings.manage', // Réglages de plateforme (ADM-09)
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

const MODERATOR: ReadonlySet<PlatformPermission> = new Set([
  'moderation.queue',
  'moderation.decide',
  'stats.read',
]);

const BY_ROLE: Readonly<Partial<Record<string, ReadonlySet<PlatformPermission>>>> = {
  USER: new Set(),
  MODERATOR,
  ADMIN: new Set(PLATFORM_PERMISSIONS),
} satisfies Record<AccountRole, ReadonlySet<PlatformPermission>>;

/** RBAC-04 : refus par défaut ; un rôle inconnu n'a rien. */
export function hasPlatformPermission(role: AccountRole, permission: PlatformPermission): boolean {
  return BY_ROLE[role]?.has(permission) ?? false;
}
