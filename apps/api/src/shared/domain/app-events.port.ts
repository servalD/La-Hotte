// Bus d'événements de domaine entre modules (ADR 0018). Publié **après** l'écriture validée en base
// (API-35) ; livré dans le processus, sans garantie en cas d'arrêt brutal. Un événement ne porte que
// des identifiants et des codes, jamais de contenu (OBS-20) : chaque abonné relit ce qu'il lui faut
// à travers le moteur de visibilité.

/** COM-14 : activité née d'un changement d'élément ; aucun texte libre. */
export type ItemActivity =
  | {
      readonly code: 'PRICE_CHANGED';
      readonly before: number | null;
      readonly after: number | null;
      readonly currency: string;
    }
  | { readonly code: 'RECEIVED' | 'UNRECEIVED' | 'SHOWN' };

/** Changement d'une liste ou d'un élément (`lists`). */
export interface ItemChanged {
  readonly type: 'item.changed';
  readonly listId: string;
  readonly itemId: string;
  readonly change: 'created' | 'updated' | 'removed';
  /** RT-08 : `givers` si le changement n'est visible que sous la forme offreur. */
  readonly audience: 'all' | 'givers';
  readonly actorId: string | null;
  readonly activity: ItemActivity | null;
  /** RT-10 : la règle de l'élément a changé (accès à revérifier). */
  readonly accessChanged: boolean;
}

export interface ListChanged {
  readonly type: 'list.changed';
  readonly listId: string;
  /** RT-10 : audience, destinataires, membres, archivage, corbeille, rattachement. */
  readonly accessChanged: boolean;
}

/** Message ou activité d'un fil (`conversations`). */
export interface CommentChanged {
  readonly type: 'comment.changed';
  readonly itemId: string;
  readonly thread: 'PUBLIC' | 'GIVERS';
  readonly commentId: string;
  readonly change: 'created' | 'updated' | 'deleted';
  readonly kind: 'MESSAGE' | 'ACTIVITY';
  readonly authorId: string | null;
  /** NOT-12 : mentions retenues (déjà filtrées par le moteur, COM-13). */
  readonly mentionIds: readonly string[];
}

export interface EventChanged {
  readonly type: 'event.changed';
  readonly eventId: string;
  /** RT-10 : participants, réponses, organisateurs, honorés, statut. */
  readonly accessChanged: boolean;
}

/** Avis d'un événement à notifier (EVT-41). */
export interface EventNotice {
  readonly type: 'event.notice';
  readonly eventId: string;
  readonly notice: 'invited' | 'cancelled' | 'reminder' | 'day_after' | 'participant_withdrew';
  readonly profileIds: readonly string[];
  readonly actorId: string | null;
}

/** EXT-06 : extraction d'une fiche terminée (`catalog`). */
export interface ProductExtracted {
  readonly type: 'product.extracted';
  readonly productId: string;
  readonly ownerId: string;
}

/** NOT-10 : notification écrite pour un profil (salon `profile:{id}`, API-33). */
export interface NotificationCreated {
  readonly type: 'notification.created';
  readonly profileId: string;
  readonly notificationId: string;
  readonly seq: number;
}

/**
 * Compta d'un élément changée (`accounting`, ADR 0019). Forme offreur exigée pour toute sortie
 * (CPT-59) ; aucun montant : les abonnés relisent à travers le moteur.
 */
export interface AccountingChanged {
  readonly type: 'accounting.changed';
  readonly accountingId: string;
  /** Absent quand l'élément a disparu (CPT-73). */
  readonly itemId: string | null;
  readonly change:
    | 'joined'
    | 'contribution'
    | 'options'
    | 'review_opened'
    | 'review_decided'
    | 'buyer_requested'
    | 'buyer'
    | 'purchased'
    | 'unchecked'
    | 'purchase'
    | 'shortfall'
    | 'settlement'
    | 'settlement_claimed'
    | 'settlement_nudged';
  readonly actorId: string | null;
  /** Participants et acheteur après l'opération : les seuls candidats d'un avis de compta. */
  readonly participantIds: readonly string[];
  readonly buyerId: string | null;
  /** CPT-19 : personnes choisies par l'auteur ; aucune autre ne reçoit l'avis du reste. */
  readonly profileIds?: readonly string[];
}

/**
 * MOD-11 : avis à l'auteur d'un contenu retiré par la modération, ou rétabli sur contestation.
 * Ni modérateur, ni signaleur, ni texte.
 */
export interface ModerationNotice {
  readonly type: 'moderation.notice';
  readonly profileId: string;
  readonly targetKind: 'PRODUCT' | 'COMMENT';
  readonly outcome: 'removed' | 'restored';
}

export type AppEvent =
  | ModerationNotice
  | ItemChanged
  | AccountingChanged
  | ListChanged
  | CommentChanged
  | EventChanged
  | EventNotice
  | ProductExtracted
  | NotificationCreated;

export type AppEventListener = (event: AppEvent) => Promise<void> | void;

export abstract class AppEvents {
  abstract publish(event: AppEvent): void;
  /** Renvoie la fonction de désabonnement. */
  abstract subscribe(listener: AppEventListener): () => void;
}
