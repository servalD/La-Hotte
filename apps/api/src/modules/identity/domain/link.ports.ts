import type {
  BlockedRow,
  CircleMember,
  InvitationLookup,
  LinkParty,
  LinkPartyDetails,
  LinkRecord,
  LinkSide,
  LinkStatus,
  OpenInvitation,
  ProfileInvitationLookup,
  ProfileProposal,
} from './link';
import type { NewProfile } from './account';

/**
 * Lecture du cercle (LNK-09), exposée aux autres modules par `identity/index.ts` : le futur
 * module `visibility` ne recalcule jamais le cercle (invariant 2). Lu en base à chaque appel, sans
 * cache : un lien rompu ou un blocage retire l'accès à la requête suivante (LNK-02).
 */
export abstract class CircleReader {
  /** Profils du cercle de `profileId` (autres profils du compte, liens acceptés, hors blocages). */
  abstract membersOf(profileId: string): Promise<string[]>;
  abstract inCircle(profileId: string, otherProfileId: string): Promise<boolean>;
  /** Vrai si l'un des deux a bloqué l'autre. */
  abstract isBlockedEitherWay(profileId: string, otherProfileId: string): Promise<boolean>;
}

/** Résultat de l'ouverture d'une invitation (LNK-06, LNK-07). */
export type RedeemOutcome =
  | { readonly kind: 'linked'; readonly linkId: string; readonly status: LinkStatus }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'already_linked' }
  | { readonly kind: 'same_account' };

/**
 * Liens, blocages et invitations (LNK-01 à LNK-10). Les paires sont sérialisées par un verrou
 * consultatif : une ouverture, un blocage et une rupture concurrents sur la même paire ne laissent
 * jamais un lien survivre à un blocage.
 */
export abstract class LinkRepository extends CircleReader {
  /** Profil et son compte ; `null` s'il n'existe pas. */
  abstract findParty(profileId: string): Promise<LinkPartyDetails | null>;

  /** LNK-09 : le cercle avec de quoi l'afficher. */
  abstract circleOf(profileId: string): Promise<CircleMember[]>;

  /**
   * LNK-01, PRO-11 : invitation `LINK`, ou `PROFILE` si `profile` est donné (compte visé, marqueur
   * du profil à créer, acceptation posée d'office pour le compte de l'invitant) ; `limit` si
   * `maxOpen` invitations, toutes sortes confondues, sont déjà ouvertes (comptées sous verrou du
   * profil).
   */
  abstract createInvitation(input: {
    readonly id: string;
    readonly tokenHash: string;
    readonly createdBy: string;
    readonly now: Date;
    readonly expiresAt: Date;
    readonly maxOpen: number;
    readonly profile?: {
      readonly targetAccountId: string;
      readonly profileIsChild: boolean;
      readonly accepted: boolean;
    };
  }): Promise<'created' | 'limit'>;

  /**
   * Invitations ouvertes du profil (ni révoquées, ni expirées, ni épuisées), et ses invitations
   * `PROFILE` refusées pas encore expirées (PRO-11 : l'invitant voit le refus).
   */
  abstract listOpenInvitations(profileId: string, now: Date): Promise<OpenInvitation[]>;

  /** Vrai si l'invitation (de toute sorte) était ouverte et appartient au profil. */
  abstract revokeInvitation(profileId: string, invitationId: string, now: Date): Promise<boolean>;

  /** Invitation `LINK` ouverte désignée par ce jeton, avec son invitant ; `null` sinon. */
  abstract findOpenInvitation(tokenHash: string, now: Date): Promise<InvitationLookup | null>;

  /**
   * LNK-06, LNK-07 : une transaction, sous verrou de la paire. Vérifie comptes différents,
   * absence de blocage et de lien, consomme l'invitation (écriture conditionnelle) puis crée le
   * lien dans l'état de `planLink`. Rien n'est consommé si le résultat n'est pas `linked`.
   */
  abstract redeemInvitation(input: {
    readonly tokenHash: string;
    readonly redeemerId: string;
    readonly linkId: string;
    readonly now: Date;
  }): Promise<RedeemOutcome>;

  /**
   * AUTH-09, LNK-08 : consomme l'invitation en attente d'un compte neuf et crée le lien avec son
   * premier profil ; **vérifie l'e-mail dans la même transaction** quand le lien est créé. `none`
   * si le compte n'attend aucune invitation ; `exhausted` si elle n'est plus utilisable
   * (rien n'est écrit).
   */
  abstract consumePendingInvitation(input: {
    readonly accountId: string;
    readonly linkId: string;
    readonly now: Date;
  }): Promise<'none' | 'linked' | 'exhausted'>;

  /** Liens vus par `actor` : ceux dont il est partie, et ceux dont il garde une partie enfant. */
  abstract listLinks(actor: LinkParty): Promise<LinkRecord[]>;

  abstract findLink(linkId: string): Promise<LinkRecord | null>;

  /**
   * LNK-06 : valide un côté encore en attente ; le lien passe à `ACCEPTED` quand chaque côté
   * requis l'est (une seule écriture). `null` si le côté n'est plus à valider.
   */
  abstract approveSide(input: {
    readonly linkId: string;
    readonly side: LinkSide;
    readonly guardianId: string;
    readonly now: Date;
  }): Promise<LinkRecord | null>;

  /**
   * LNK-02 : supprime le lien, sous verrou de sa paire. `null` s'il n'existe plus ;
   * `guardian_required` pour le dernier lien de tutelle d'un enfant (PRO-15).
   */
  abstract deleteLink(linkId: string): Promise<LinkRecord | null | 'guardian_required'>;

  /**
   * LNK-05 : bloque `blockedId` parmi les contreparties d'un lien de `blockerId` et supprime ce
   * lien, dans la même transaction. `not_linked` si aucun lien n'existe entre les deux.
   */
  abstract block(input: {
    readonly id: string;
    readonly blockerId: string;
    readonly blockedId: string;
    readonly now: Date;
  }): Promise<'blocked' | 'not_linked'>;

  /** Vrai si le blocage existait. Le lien n'est pas rétabli (LNK-05). */
  abstract unblock(blockerId: string, blockedId: string): Promise<boolean>;

  abstract listBlocks(blockerId: string): Promise<BlockedRow[]>;

  /** PRO-11 : propositions ouvertes reçues par le compte, pas encore acceptées ni refusées. */
  abstract listProfileProposals(accountId: string, now: Date): Promise<ProfileProposal[]>;

  /**
   * PRO-11 : décision du compte visé. L'acceptation revérifie, sous verrou, qu'un profil du compte
   * est lié à l'invitant sans blocage ; sinon l'invitation est révoquée comme refusée (`revoked`).
   * `missing` si ce n'est pas une proposition ouverte de ce compte.
   */
  abstract decideProfileProposal(input: {
    readonly invitationId: string;
    readonly accountId: string;
    readonly accept: boolean;
    readonly now: Date;
  }): Promise<'accepted' | 'refused' | 'revoked' | 'missing'>;

  /** PRO-11 : invitation `PROFILE` ouverte désignée par ce jeton, acceptée ou non ; `null` sinon. */
  abstract findProfileInvitation(
    tokenHash: string,
    now: Date,
  ): Promise<ProfileInvitationLookup | null>;

  /**
   * PRO-11, une transaction : invitation verrouillée, acceptation du compte visé exigée (`pending`
   * sinon), lien et absence de blocage revérifiés pour un autre compte, plafond de PRO-01 sous
   * verrou du compte (`limit`), profil créé, invitation consommée, lien `ACCEPTED` créé avec
   * l'invitant si le compte n'est pas le sien. Rien n'est écrit hors de `created`.
   */
  abstract redeemProfileInvitation(input: {
    readonly tokenHash: string;
    readonly profile: NewProfile;
    readonly pinHash: string | null;
    readonly linkId: string;
    readonly now: Date;
  }): Promise<
    | {
        readonly status: 'created';
        readonly targetAccountId: string;
        readonly inviterId: string;
        readonly inviterAccountId: string;
        readonly isChild: boolean;
      }
    | { readonly status: 'invalid' | 'pending' | 'limit' }
  >;

  /** LNK-10 : supprime les invitations terminées avant `before`. Renvoie leur nombre. */
  abstract purgeInvitations(before: Date): Promise<number>;
}
