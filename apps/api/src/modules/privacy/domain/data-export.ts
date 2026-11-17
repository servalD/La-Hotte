import { DomainError } from '../../../shared/domain';

/** RGPD-11 : un fichier se télécharge une fois, dans les 24 heures. */
export const EXPORT_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** RGPD-11 : une demande par jour et par profil. */
export const EXPORT_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const EXPORT_FORMAT = 'la-hotte-export/1';

/**
 * Fichiers d'export (RGPD-11) : chiffrés au repos (SEC-22), rendus une seule fois puis effacés.
 * Le magasin chiffre et déchiffre ; le domaine ne voit que le texte.
 */
export abstract class DataExportStore {
  abstract lastRequestedAt(profileId: string): Promise<Date | null>;

  abstract create(input: {
    readonly id: string;
    readonly profileId: string;
    readonly requestedAt: Date;
    readonly expiresAt: Date;
    readonly payload: string;
  }): Promise<void>;

  /**
   * Rend le fichier et l'efface, atomiquement, s'il est à ce profil, non échu et pas encore
   * téléchargé ; `null` sinon.
   */
  abstract take(input: {
    readonly id: string;
    readonly profileId: string;
    readonly now: Date;
  }): Promise<string | null>;

  /** Fichiers échus effacés ; rend leur nombre. */
  abstract purge(now: Date): Promise<number>;
}

/** RGPD-11 : une demande par jour. */
export class DataExportRateLimitedError extends DomainError {
  readonly kind = 'rate_limited';
  readonly code = 'EXPORT_RATE_LIMITED';
  constructor(override readonly retryAfterSeconds: number) {
    super('Un export a déjà été demandé aujourd’hui pour ce profil.');
  }
}

/** RGPD-11, SEC-04 : inconnu, d'un autre profil, échu ou déjà téléchargé : même réponse. */
export class DataExportNotFoundError extends DomainError {
  readonly kind = 'not_found';
  readonly code = 'EXPORT_NOT_FOUND';
  constructor() {
    super('Export introuvable ou déjà téléchargé.');
  }
}
