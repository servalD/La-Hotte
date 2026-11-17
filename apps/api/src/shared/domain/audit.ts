/**
 * Journal d'audit (AUD-01, AUD-06) : noyau partagé, parce que les actions d'administration
 * touchent plusieurs modules et que chacune écrit son entrée dans sa propre transaction (AUD-05).
 * Une entrée ne porte jamais de contenu : ni titre, ni commentaire, ni adresse e-mail en clair.
 */
export const AUDIT_ACTIONS = [
  'audit.read', // AUD-04
  'account.search', // ADM-10 (empreinte de l'adresse, jamais l'adresse)
  'account.suspend', // ADM-06
  'account.reactivate', // ADM-06
  'account.force_logout', // ADM-08
  'account.totp_reset_requested', // ADM-07
  'account.totp_reset_completed', // ADM-07, à l'ouverture du lien par le titulaire
  'role.grant', // RBAC-07
  'role.revoke', // RBAC-03, RBAC-07
  'role.grant_by_operator', // RBAC-03 : commande d'exploitation du premier administrateur
  'setting.update', // ADM-09
  'moderation.decide', // MOD-10, MOD-11
  'publication.restore', // MOD-10 : levée de la suspension de publication
  'followup.failed', // AUD-05 : la suite hors base d'une action a échoué
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_TARGET_KINDS = ['ACCOUNT', 'PRODUCT', 'COMMENT', 'SETTING'] as const;
export type AuditTargetKind = (typeof AUDIT_TARGET_KINDS)[number];

/** Valeur d'un réglage (ADM-09) : jamais un contenu d'utilisateur. */
export type AuditValue = string | number | boolean | null | readonly string[];

export interface AuditEntry {
  /** `null` : action de la commande d'exploitation, hors de tout compte. */
  readonly actorAccountId: string | null;
  readonly action: AuditAction;
  readonly targetKind: AuditTargetKind | null;
  /** Identifiant opaque (compte, fiche, commentaire) ; `null` pour un réglage ou une recherche. */
  readonly targetId: string | null;
  /** RBAC-06 : motif saisi, 10 à 500 caractères ; `null` pour une consultation. */
  readonly reason: string | null;
  readonly ip: string | null;
  readonly before?: AuditValue;
  readonly after?: AuditValue;
}
