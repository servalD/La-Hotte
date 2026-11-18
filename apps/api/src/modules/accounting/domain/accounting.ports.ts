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
  /**
   * Lecture au nom de `viewerId` (DAT-05) : la base n'en rend ni parts ni achat à un destinataire
   * de la liste. Défense supplémentaire : le moteur décide toujours le niveau d'accès.
   */
  abstract findByItemAs(viewerId: string, itemId: string): Promise<AccountingState | null>;
  abstract findById(accountingId: string): Promise<AccountingState | null>;
  /** CPT-58 : fiche d'une demande de revue en attente. */
  abstract findByPendingReview(reviewId: string): Promise<AccountingState | null>;
  /** CPT-61 : fiche d'une demande de changement d'acheteur en attente. */
  abstract findByPendingBuyerRequest(requestId: string): Promise<AccountingState | null>;
  /** CPT-11 : fiches dont le profil est acheteur, plus récentes d'abord. */
  abstract findByBuyer(profileId: string): Promise<AccountingState[]>;
  /** CPT-20 à CPT-23 : fiche d'une participation. */
  abstract findByContribution(contributionId: string): Promise<AccountingState | null>;
  /** CPT-30, CPT-41 : fiches où le profil participe ou achète. */
  abstract findByProfile(profileId: string): Promise<AccountingState[]>;

  /**
   * CPT-68 : plusieurs fiches dans une seule transaction, verrouillées dans l'ordre de leurs
   * identifiants ; la proposition de compensation change d'état dans la même transaction.
   */
  abstract mutateMany(input: {
    readonly accountingIds: readonly string[];
    readonly actorId: string;
    readonly operationId: string;
    readonly idempotency: IdempotencyInput;
    readonly proposal: { readonly id: string; readonly status: OffsetStatus };
    readonly work: (states: ReadonlyMap<string, AccountingState>) => {
      readonly works: readonly AccountingWork[];
      readonly response: StoredResponse;
    };
  }): Promise<{ readonly replayed: boolean; readonly response: StoredResponse }>;

  /**
   * CPT-23, CPT-66 : parts dues dont un rappel automatique est échu (J+7 après l'achat, puis la
   * date de l'événement), chacune réclamée une seule fois (colonne « fait le »).
   */
  abstract claimDueReminders(now: Date, today: string): Promise<DueReminder[]>;
  /** CPT-64 : fiches achetées, avec un reste, dont l'événement est passé. */
  abstract shortfallsAfterEvent(today: string): Promise<string[]>;

  abstract createOffset(proposal: OffsetProposal): Promise<void>;
  abstract findOffset(id: string): Promise<OffsetProposal | null>;
  abstract pendingOffset(a: string, b: string, currency: string): Promise<OffsetProposal | null>;
  /** CPT-75 : propositions en attente dont le profil est l'auteur ou le destinataire. */
  abstract pendingOffsetsOf(profileId: string): Promise<OffsetProposal[]>;
  abstract setOffsetStatus(id: string, status: OffsetStatus, at: Date): Promise<void>;
}

export interface DueReminder {
  readonly accountingId: string;
  readonly itemId: string | null;
  readonly participantId: string;
  readonly participantIds: readonly string[];
  readonly buyerId: string | null;
}

export type OffsetStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED' | 'STALE';

/** CPT-68 : proposition de compensation, avec les montants dus relevés à la proposition. */
export interface OffsetProposal {
  readonly id: string;
  readonly proposerId: string;
  readonly counterpartId: string;
  readonly currency: string;
  readonly snapshot: readonly { readonly contributionId: string; readonly owed: number }[];
  readonly status: OffsetStatus;
  readonly createdAt: Date;
}

export interface BudgetRecord {
  readonly id: string;
  readonly profileId: string;
  readonly eventId: string;
  readonly recipientId: string | null;
  readonly amountMinor: number;
  readonly currency: string;
}

/** CPT-40, CPT-69 : budgets privés, lus et écrits pour leur seul profil. */
export abstract class BudgetRepository {
  abstract list(profileId: string, eventId: string | null): Promise<BudgetRecord[]>;
  abstract upsert(budget: BudgetRecord): Promise<BudgetRecord>;
  abstract delete(profileId: string, id: string): Promise<boolean>;
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
