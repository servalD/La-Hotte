/**
 * Liens, cercle, invitations, blocages (LNK-01 à LNK-10, PRO-05). Règles pures : rangement de la
 * paire, état initial d'un lien selon les profils enfants, éligibilité du tuteur, masquage du nom
 * d'un enfant. Aucune entrée-sortie.
 */

const DAY = 24 * 60 * 60 * 1000;

/** LNK-01 : une invitation expire après 7 jours. */
export const INVITATION_TTL_MS = 7 * DAY;
/** LNK-10 : une invitation terminée est supprimée 30 jours après son terme (RGPD-09). */
export const INVITATION_RETENTION_MS = 30 * DAY;
/** LNK-01 : invitations ouvertes par profil, et créations par 24 heures. */
export const MAX_OPEN_INVITATIONS_PER_PROFILE = 20;
/** LNK-01 : jeton de 128 bits en base64url, sans remplissage : 22 caractères. */
export const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export type LinkStatus = 'PENDING' | 'AWAITING_GUARDIAN' | 'ACCEPTED';

/**
 * LNK-11, PRO-15 : d'où vient un lien. `TRANSFER` et `GUARDIANSHIP` naissent acceptés ;
 * `GUARDIANSHIP` seul fonde la tutelle d'un compte sous tutelle.
 */
export type LinkOrigin = 'INVITATION' | 'TRANSFER' | 'GUARDIANSHIP';

/** Les deux côtés d'un lien, rangés par identifiant (`a < b`, contrainte de base). */
export type LinkSide = 'A' | 'B';

/** Profil tel que le voient les règles de lien. */
export interface LinkParty {
  readonly id: string;
  readonly accountId: string;
  readonly isChild: boolean;
  /**
   * PRO-15 : pour un enfant d'un compte sous tutelle, ses tuteurs : les profils non enfants du
   * compte tuteur qui lui sont reliés par un lien `GUARDIANSHIP`, calculés par le dépôt. Absent ou
   * vide : aucun tuteur hors de son propre compte (échec fermé).
   */
  readonly wardGuardianIds?: readonly string[];
}

/** Profil d'une partie, avec de quoi l'afficher. */
export interface LinkPartyDetails extends LinkParty {
  readonly displayName: string;
  readonly accentColor: string;
  readonly avatar: string | null;
}

/** Paire rangée : le plus petit identifiant en premier (LNK-02, `CHECK a < b`). */
export function orderPair<T extends { readonly id: string }>(x: T, y: T): readonly [T, T] {
  return x.id < y.id ? [x, y] : [y, x];
}

/** LNK-06 : état initial et exigences de validation d'un lien créé par ouverture d'invitation. */
export interface LinkPlan {
  readonly status: Extract<LinkStatus, 'AWAITING_GUARDIAN' | 'ACCEPTED'>;
  readonly aGuardianRequired: boolean;
  readonly bGuardianRequired: boolean;
}

/**
 * LNK-06 : un lien est accepté d'office, sauf si l'un des deux est un profil enfant : le lien
 * attend alors la validation de chaque côté enfant. L'exigence est figée à la création.
 */
export function planLink(a: Pick<LinkParty, 'isChild'>, b: Pick<LinkParty, 'isChild'>): LinkPlan {
  const aGuardianRequired = a.isChild;
  const bGuardianRequired = b.isChild;
  return {
    status: aGuardianRequired || bGuardianRequired ? 'AWAITING_GUARDIAN' : 'ACCEPTED',
    aGuardianRequired,
    bGuardianRequired,
  };
}

/**
 * PRO-05, LNK-06, PRO-15 : un tuteur est un profil non enfant **du compte de l'enfant**, ou, pour
 * un enfant d'un compte sous tutelle, **du compte tuteur relié à lui par un lien de tutelle**
 * (`wardGuardianIds`). Un adulte arrivé plus tard dans le compte tuteur n'en est pas tuteur.
 * Point unique de la règle : aucun autre endroit ne la réécrit (SQL de `approveSide` mis à part,
 * qui la revérifie en base).
 */
export function isGuardianOf(
  guardian: Pick<LinkParty, 'id' | 'accountId' | 'isChild'>,
  child: Pick<LinkParty, 'id' | 'accountId' | 'isChild' | 'wardGuardianIds'>,
): boolean {
  if (!child.isChild || guardian.isChild || guardian.id === child.id) return false;
  if (guardian.accountId === child.accountId) return true;
  return child.wardGuardianIds?.includes(guardian.id) ?? false;
}

/** Un lien et ses deux parties, tels que les lit un cas d'usage. */
export interface LinkRecord {
  readonly id: string;
  readonly status: LinkStatus;
  readonly origin: LinkOrigin;
  readonly requestedBy: string;
  readonly a: LinkPartyDetails;
  readonly b: LinkPartyDetails;
  readonly aGuardianRequired: boolean;
  readonly bGuardianRequired: boolean;
  readonly aGuardianApprovedBy: string | null;
  readonly bGuardianApprovedBy: string | null;
  readonly createdAt: Date;
}

/** Côté d'un profil dans un lien, `null` s'il n'en est pas partie. */
export function sideOf(link: LinkRecord, profileId: string): LinkSide | null {
  if (link.a.id === profileId) return 'A';
  if (link.b.id === profileId) return 'B';
  return null;
}

/**
 * LNK-06 : côté que `guardian` peut valider : exigé, pas encore validé, et dont le profil est un
 * enfant dont `guardian` est le tuteur. `null` sinon.
 */
export function approvableSide(link: LinkRecord, guardian: LinkParty): LinkSide | null {
  if (link.status !== 'AWAITING_GUARDIAN') return null;
  if (link.aGuardianRequired && !link.aGuardianApprovedBy && isGuardianOf(guardian, link.a)) {
    return 'A';
  }
  if (link.bGuardianRequired && !link.bGuardianApprovedBy && isGuardianOf(guardian, link.b)) {
    return 'B';
  }
  return null;
}

/**
 * LNK-02 : qui peut rompre un lien : l'une des parties, ou le tuteur d'une partie enfant.
 * PRO-15 : un lien de tutelle ne se rompt pas depuis le compte sous tutelle, seulement par la
 * partie non enfant (le tuteur) ; que ce ne soit pas le dernier tuteur de l'enfant se vérifie en
 * base (`GUARDIAN_REQUIRED`).
 */
export function canBreakLink(link: LinkRecord, actor: LinkParty): boolean {
  if (link.origin === 'GUARDIANSHIP') {
    const side = sideOf(link, actor.id);
    if (side === null) return false;
    return !(side === 'A' ? link.a : link.b).isChild;
  }
  return (
    link.a.id === actor.id ||
    link.b.id === actor.id ||
    isGuardianOf(actor, link.a) ||
    isGuardianOf(actor, link.b)
  );
}

/** Rôle d'un profil dans un lien qu'il voit : partie, ou tuteur d'une partie enfant. */
export type LinkRole = 'PARTY' | 'GUARDIAN';

/** Vue d'un lien pour un profil (`GET /links`). */
export interface LinkView {
  readonly id: string;
  readonly status: LinkStatus;
  readonly role: LinkRole;
  /** L'autre partie ; pour un tuteur, la partie qui n'est pas l'enfant qu'il garde. */
  readonly counterpart: {
    readonly profileId: string;
    readonly displayName: string | null;
    readonly accentColor: string;
  };
  /** Pour un tuteur : l'enfant concerné. Pour une partie : `null`. */
  readonly child: { readonly profileId: string; readonly displayName: string } | null;
  /** Vrai si `viewer` peut valider un côté de ce lien. */
  readonly awaitingMyApproval: boolean;
  readonly createdAt: Date;
}

/**
 * PRO-05, LNK-06 : le nom d'un enfant n'est jamais rendu à l'autre partie tant que le lien n'est
 * pas accepté ; un tuteur le voit toujours (c'est l'enfant de son compte).
 */
export function visibleName(
  party: Pick<LinkPartyDetails, 'displayName' | 'isChild'>,
  status: LinkStatus,
): string | null {
  return party.isChild && status !== 'ACCEPTED' ? null : party.displayName;
}

/** Vue d'un lien pour `viewer`, ou `null` s'il n'en est ni partie ni tuteur d'une partie. */
export function linkViewFor(link: LinkRecord, viewer: LinkParty): LinkView | null {
  const side = sideOf(link, viewer.id);
  if (side !== null) {
    const other = side === 'A' ? link.b : link.a;
    return {
      id: link.id,
      status: link.status,
      role: 'PARTY',
      counterpart: {
        profileId: other.id,
        displayName: visibleName(other, link.status),
        accentColor: other.accentColor,
      },
      child: null,
      awaitingMyApproval: approvableSide(link, viewer) !== null,
      createdAt: link.createdAt,
    };
  }
  const kept = [link.a, link.b].find((party) => isGuardianOf(viewer, party));
  if (!kept) return null;
  const other = kept.id === link.a.id ? link.b : link.a;
  return {
    id: link.id,
    status: link.status,
    role: 'GUARDIAN',
    counterpart: {
      profileId: other.id,
      // I1 (SEC-40) : le tuteur n'est pas dans le cercle de l'enfant d'en face.
      displayName: other.isChild ? null : visibleName(other, link.status),
      accentColor: other.accentColor,
    },
    child: { profileId: kept.id, displayName: kept.displayName },
    awaitingMyApproval: approvableSide(link, viewer) !== null,
    createdAt: link.createdAt,
  };
}

/** Membre du cercle d'un profil (LNK-09). */
export interface CircleMember {
  readonly profileId: string;
  readonly displayName: string;
  readonly avatar: string | null;
  readonly accentColor: string;
  /** `ACCOUNT` : autre profil du même compte (LNK-03) ; `LINK` : lien accepté. */
  readonly source: 'ACCOUNT' | 'LINK';
}

/** Invitation ouverte, telle que la liste son créateur (jamais le jeton). */
export interface OpenInvitation {
  readonly id: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/**
 * Invitation retrouvée par son jeton : l'invitant, de quoi décider d'un lien. Le nom n'est rendu
 * que si l'invitant n'est pas un enfant (LNK-07).
 */
export interface InvitationLookup {
  readonly id: string;
  readonly inviter: LinkPartyDetails;
  readonly expiresAt: Date;
}

/** Ligne de blocage telle que lue en base, avant masquage (PRO-05). */
export interface BlockedRow {
  readonly profileId: string;
  readonly displayName: string;
  readonly accentColor: string;
  readonly isChild: boolean;
}

/** PRO-05 : le nom d'un enfant n'apparaît jamais hors de son cercle, donc pas dans la liste des blocages. */
export function toBlockedProfile(row: BlockedRow): BlockedProfile {
  return {
    profileId: row.profileId,
    displayName: row.isChild ? null : row.displayName,
    accentColor: row.accentColor,
  };
}

/** LNK-05 : profil bloqué, tel que le voit celui qui l'a bloqué. */
export interface BlockedProfile {
  readonly profileId: string;
  /** Absent pour un enfant : son nom n'apparaît jamais hors de son cercle (PRO-05). */
  readonly displayName: string | null;
  readonly accentColor: string;
}
