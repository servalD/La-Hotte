import type { SessionRef } from './ports';
import type { TransferKind, TransferPinChoice, TransferSubject } from './transfer';

/** Demande de passage ou de détachement, telle que la lisent les cas d'usage (PRO-12, PRO-13). */
export interface TransferState {
  readonly id: string;
  readonly kind: Extract<TransferKind, 'MOVE' | 'DETACH'>;
  readonly profileId: string;
  readonly fromAccountId: string;
  readonly toAccountId: string | null;
  /** PRO-13 : adresse du nouveau compte. */
  readonly newEmail: string | null;
  readonly profileConsentRequired: boolean;
  readonly regroup: boolean;
  readonly fromAcceptedAt: Date;
  readonly toAcceptedAt: Date | null;
  readonly profileAcceptedAt: Date | null;
  readonly pinChoice: TransferPinChoice;
  readonly executesAt: Date | null;
  readonly expiresAt: Date;
}

/** PRO-12 : passage accepté vu par le compte d'arrivée (nom et couleur du profil seulement). */
export interface IncomingTransfer {
  readonly id: string;
  readonly profileName: string;
  readonly accentColor: string;
  readonly executesAt: Date | null;
}

/** Profil qui part, vu par l'espace Compte d'arrivée avant d'accepter (PRO-12). */
export interface TransferPreview {
  readonly transferId: string;
  readonly profileName: string;
  readonly avatar: string | null;
  readonly accentColor: string;
  readonly isChild: boolean;
}

/** Ce qu'une exécution a changé, pour les effets qui suivent la transaction (PRO-14). */
export interface CompletedTransfer {
  readonly status: 'completed';
  readonly profileId: string;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  /** Sessions du compte d'origine où le profil était actif, désélectionnées en base. */
  readonly deselected: readonly SessionRef[];
  /** Profils dont le cercle a changé (LNK-09). */
  readonly circleChanged: readonly string[];
  /** PRO-12 : le compte d'origine n'a plus de profil (regroupement) ; il reste à le supprimer. */
  readonly fromEmptied: boolean;
  /** Adresse vérifiée du profil, pour l'avis ; `null` sans adresse. */
  readonly profileEmail: string | null;
}

/**
 * Demandes de changement de compte en base (PRO-12 à PRO-14). Chaque écriture est conditionnelle
 * (demande encore ouverte) ; l'échéance d'exécution est calculée en base au dernier accord, pour
 * que deux accords simultanés ne la manquent pas.
 */
export abstract class TransferRepository {
  /** Ce que les règles d'accord lisent du profil (PRO-12), avec son compte et son adresse. */
  abstract subject(profileId: string): Promise<
    | (TransferSubject & {
        readonly accountId: string;
        readonly email: string | null;
      })
    | null
  >;

  /**
   * PRO-12 : nouvelle demande. `pending` si le profil a déjà une demande ouverte (index unique
   * partiel), `missing` si le profil n'est pas du compte d'origine.
   */
  abstract create(input: {
    readonly id: string;
    readonly kind: 'MOVE' | 'DETACH';
    readonly profileId: string;
    readonly fromAccountId: string;
    readonly newEmail: string | null;
    readonly tokenHash: string;
    readonly tokenExpiresAt: Date;
    readonly expiresAt: Date;
    readonly profileConsentRequired: boolean;
    readonly regroup: boolean;
    readonly pinChoice: TransferPinChoice;
    readonly newPinHash: string | null;
    readonly now: Date;
  }): Promise<'created' | 'pending' | 'missing'>;

  abstract findOpenByProfile(profileId: string, now: Date): Promise<TransferState | null>;

  /** Demande ouverte désignée par son jeton (passage ou lien d'installation), jeton valable. */
  abstract findOpenByToken(
    tokenHash: string,
    kind: 'MOVE' | 'DETACH',
    now: Date,
  ): Promise<TransferState | null>;

  /**
   * PRO-12 : le compte `toAccountId` peut recevoir le profil : autre compte, actif, hors tutelle
   * (le tuteur seul accepte pour un compte sous tutelle), portant un profil lié (`ACCEPTED`) au
   * profil qui part, et aucun profil qui le bloque ou qu'il bloque.
   */
  abstract canReceive(profileId: string, toAccountId: string): Promise<boolean>;

  abstract preview(transferId: string): Promise<TransferPreview | null>;

  /** PRO-12 : accord du compte d'arrivée ; l'échéance est posée si c'est le dernier accord. */
  abstract acceptDestination(input: {
    readonly transferId: string;
    readonly toAccountId: string;
    readonly now: Date;
  }): Promise<boolean>;

  /** PRO-12 : retrait de l'acceptation, tant que le passage n'est pas exécuté. */
  abstract withdrawDestination(transferId: string, toAccountId: string): Promise<boolean>;

  /** PRO-12 : accord du profil, avec son choix de PIN, qui l'emporte sur celui de la demande. */
  abstract consentProfile(input: {
    readonly transferId: string;
    readonly pinChoice: TransferPinChoice;
    readonly newPinHash: string | null;
    readonly now: Date;
  }): Promise<boolean>;

  /** Annulation par une partie ; `false` si la demande n'est plus ouverte. */
  abstract cancel(transferId: string, now: Date): Promise<boolean>;

  /** PRO-12 : passages acceptés par le compte, pas encore exécutés. */
  abstract listIncoming(toAccountId: string, now: Date): Promise<IncomingTransfer[]>;

  /** Demandes dont l'échéance est passée : passages à exécuter, détachements à installer. */
  abstract due(now: Date): Promise<{ readonly id: string; readonly kind: 'MOVE' | 'DETACH' }[]>;

  /** PRO-13 : nouveau lien d'installation, une fois l'échéance passée (24 heures, renvoyable). */
  abstract issueSetupToken(input: {
    readonly transferId: string;
    readonly tokenHash: string;
    readonly tokenExpiresAt: Date;
    readonly now: Date;
  }): Promise<boolean>;

  /** PRO-13 : le lien d'installation a déjà été envoyé pour cette échéance. */
  abstract setupSent(transferId: string): Promise<boolean>;

  /**
   * PRO-14, une transaction sous les verrous des comptes (ordre des identifiants), qui revérifie
   * chaque condition. Pour un détachement, `newAccount` est créé dans la même transaction.
   * `failed` : une condition ne tient plus ; la demande perd l'acceptation du compte d'arrivée
   * (vu comme un retrait, LNK-05). `not_due` : rien à faire.
   */
  abstract execute(input: {
    readonly transferId: string;
    readonly now: Date;
    readonly linkIds: () => string;
    readonly newAccount?: {
      readonly id: string;
      readonly email: string;
      readonly passwordHash: string;
    };
  }): Promise<CompletedTransfer | { readonly status: 'failed' | 'not_due' | 'email_taken' }>;

  /**
   * PRO-12 : noms des profils du compte d'arrivée liés au profil qui part (l'écran d'accord du
   * profil montre où il va, par ceux qu'il connaît).
   */
  abstract linkedNamesIn(profileId: string, accountId: string): Promise<string[]>;

  /** PRO-12 : lien d'accord ou d'annulation envoyé au profil (`account_token`, une demande). */
  abstract issueMailToken(input: {
    readonly id: string;
    readonly accountId: string;
    readonly profileId: string;
    readonly transferId: string;
    readonly purpose: 'TRANSFER_CONSENT' | 'TRANSFER_CANCEL';
    readonly tokenHash: string;
    readonly now: Date;
    readonly expiresAt: Date;
  }): Promise<void>;

  /** Jeton ouvert de cet usage, lu sans être consommé ; `null` sinon. */
  abstract findMailToken(
    tokenHash: string,
    purpose: 'TRANSFER_CONSENT' | 'TRANSFER_CANCEL',
    now: Date,
  ): Promise<{ readonly transferId: string; readonly profileId: string } | null>;

  /** Usage unique ; faux si le jeton ne sert plus. */
  abstract consumeMailToken(
    tokenHash: string,
    purpose: 'TRANSFER_CONSENT' | 'TRANSFER_CANCEL',
    now: Date,
  ): Promise<boolean>;

  /** PRO-12, regroupement : compte sans profil suspendu, époque écrite (ADR 0014). */
  abstract suspendEmptyAccount(accountId: string, authEpoch: number): Promise<boolean>;

  /** PRO-12, regroupement : compte suspendu et sans profil supprimé (sessions déjà révoquées). */
  abstract deleteEmptyAccount(accountId: string): Promise<boolean>;
}
