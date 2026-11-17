import type { AccountingDiff, AccountingState } from './accounting-state';

/** CPT-71 : clé d'idempotence d'une requête, avec l'empreinte de la requête. */
export interface IdempotencyInput {
  readonly profileId: string;
  readonly key: string;
  readonly requestHash: string;
}

/** Réponse rendue par une opération, enregistrée pour un rejeu (CPT-71). */
export interface StoredResponse {
  readonly status: number;
  readonly body: unknown;
}

/** Ce que l'opération décide sous verrou : l'état suivant, la différence et la réponse. */
/** CPT-19 : personnes prévenues d'un reste à couvrir, lues par leur seul auteur. */
export interface ShortfallNoticeDraft {
  readonly id: string;
  readonly authorId: string;
  readonly amount: number;
  readonly notifiedIds: readonly string[];
}

export interface AccountingWork {
  readonly next: AccountingState;
  readonly diff: AccountingDiff;
  readonly response: StoredResponse;
  readonly notice?: ShortfallNoticeDraft;
}

export type AccountingKey = { readonly itemId: string } | { readonly accountingId: string };

export type MutateResult =
  | { readonly replayed: false; readonly state: AccountingState; readonly response: StoredResponse }
  | { readonly replayed: true; readonly response: StoredResponse };

/**
 * Dépôt de la compta (ADR 0019). `mutate` ouvre une transaction, enregistre la clé
 * d'idempotence avant tout effet (rejeu ou `409` si elle sert déjà), verrouille la fiche (et
 * l'élément quand il faut l'ouvrir), passe l'état à `work`, puis écrit la différence et les
 * écritures du journal dans la même transaction, avec l'état réel de l'élément (LST-11, LST-12).
 * Une erreur levée par `work` annule tout, clé comprise.
 */
export abstract class AccountingRepository {
  abstract mutate(input: {
    readonly key: AccountingKey;
    /** Absent pour une opération du système (réconciliation, tâche planifiée). */
    readonly actorId: string | null;
    readonly operationId: string;
    /** Absente pour une opération du système, jamais rejouée par un client. */
    readonly idempotency: IdempotencyInput | null;
    readonly work: (state: AccountingState | null) => AccountingWork;
  }): Promise<MutateResult>;

  abstract findByItem(itemId: string): Promise<AccountingState | null>;
  abstract findById(accountingId: string): Promise<AccountingState | null>;
  /** CPT-58 : fiche d'une demande de revue en attente. */
  abstract findByPendingReview(reviewId: string): Promise<AccountingState | null>;
  /** CPT-61 : fiche d'une demande de changement d'acheteur en attente. */
  abstract findByPendingBuyerRequest(requestId: string): Promise<AccountingState | null>;
  /** CPT-11 : fiches dont le profil est acheteur, plus récentes d'abord. */
  abstract findByBuyer(profileId: string): Promise<AccountingState[]>;
}

export interface PersonCard {
  readonly id: string;
  readonly displayName: string;
  readonly avatar: string | null;
  readonly accentColor: string;
}

/** Cartes des participants (noms relus à l'affichage). */
export abstract class AccountingPeople {
  abstract cards(profileIds: readonly string[]): Promise<PersonCard[]>;
}
