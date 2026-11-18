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

/** Valeur simple d'un réglage ou d'un rôle : jamais un contenu d'utilisateur. */
export type AuditScalar = string | number | boolean | null | readonly string[];

/** ADM-09 : un réglage est journalisé avec sa clé. */
export type AuditValue = AuditScalar | { readonly key: string; readonly value: AuditScalar };

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

/** Entrée prête à écrire : identifiant et instant fixés par le cas d'usage. */
export interface AuditWrite {
  readonly id: string;
  readonly at: Date;
  readonly entry: AuditEntry;
}

/**
 * Entrée écrite seule, hors de la transaction d'une action : la suite d'une action qui a échoué
 * (AUD-05, `followup.failed`). Toute autre entrée s'écrit dans la transaction de son action.
 */
export abstract class AuditJournal {
  abstract append(write: AuditWrite): Promise<void>;
}
