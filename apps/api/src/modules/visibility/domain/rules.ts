import {
  type EventMembership,
  isEventClosed,
  respondedPresent,
  wishlistRecipientsAllowed,
} from './events';
import type { GiftContent, ItemFacts, ItemRule, ListFacts, ListRole, ViewerContext } from './facts';

// Moteur de visibilité (04, ADR 0004, ADR 0016). Fonctions pures : la seule réponse à « ce profil
// voit-il ceci, et sous quelle forme ? ». Ordre des niveaux : la règle de surprise d'abord
// (VIS-21, elle prime), puis l'audience de la liste, puis la règle de l'élément.

/** Accès d'un profil à une liste. */
export type ListAccess =
  | { readonly kind: 'none' }
  /** Destinataire d'une wishlist (VIS-20) : vue destinataire, jamais de donnée d'offreur. */
  | { readonly kind: 'recipient'; readonly role: ListRole | null }
  /** Destinataire d'une giftlist révélée (GFT-03, GFT-09) : l'existence, et le contenu montré. */
  | { readonly kind: 'gift_recipient'; readonly content: GiftContent }
  /** Offreur dans l'audience : membre ou non (`role` absent). */
  | { readonly kind: 'giver'; readonly role: ListRole | null };

/** Forme sous laquelle un élément est montré. */
export type ItemAccess = 'none' | 'recipient' | 'giver';

const NONE: ListAccess = { kind: 'none' };

function roleOf(list: ListFacts, profileId: string): ListRole | null {
  return list.members.find((member) => member.profileId === profileId)?.role ?? null;
}

/**
 * Autorité de la liste (LST-04, LST-09) : le créateur, ou à défaut le plus ancien responsable.
 * `null` si la liste n'a ni l'un ni l'autre.
 */
export function authorityOf(list: ListFacts): string | null {
  const creator = list.members.find((member) => member.role === 'CREATOR');
  if (creator) return creator.profileId;
  const owners = list.members
    .filter((member) => member.role === 'OWNER')
    .sort(
      (a, b) => a.since.getTime() - b.since.getTime() || a.profileId.localeCompare(b.profileId),
    );
  return owners[0]?.profileId ?? null;
}

function inAudience(list: ListFacts, viewer: ViewerContext, role: ListRole | null): boolean {
  if (role) return true; // VIS-03 : les membres sont toujours dans l'audience.
  switch (list.audience) {
    case 'MEMBERS':
      return false;
    case 'CIRCLE':
      return viewer.inRecipientsCircle;
    case 'EVENT':
      // VIS-03, EVT-14 : participants `Participe` ou `Peut-être` ; détachée, les membres seuls.
      return list.event?.audience.includes(viewer.profileId) ?? false;
    case 'CUSTOM':
      return list.customAudience.includes(viewer.profileId);
  }
}

/** VIS-01 à VIS-03, VIS-20, VIS-21, GFT-03, GFT-07, GFT-09, LST-20. */
export function listAccess(list: ListFacts, viewer: ViewerContext): ListAccess {
  const role = roleOf(list, viewer.profileId);
  // LST-20 : une liste à la corbeille n'est vue que de son autorité.
  if (list.deleted && authorityOf(list) !== viewer.profileId) return NONE;

  if (list.recipients.includes(viewer.profileId)) {
    if (list.type === 'WISHLIST') return { kind: 'recipient', role };
    // GFT-07 : cachée, rien n'apparaît ; GFT-01 : un destinataire n'est jamais membre.
    if (list.giftExistence === 'HIDDEN' || list.deleted) return NONE;
    return { kind: 'gift_recipient', content: list.giftContent };
  }
  if (!inAudience(list, viewer, role)) return NONE;
  return { kind: 'giver', role };
}

/** VIS-10 : vrai si la règle écarte ce profil. */
export function ruleExcludes(rule: ItemRule, profileId: string): boolean {
  switch (rule.mode) {
    case 'ALL':
      return false;
    case 'ONLY':
      return !rule.profiles.includes(profileId);
    case 'EXCEPT':
      return rule.profiles.includes(profileId);
  }
}

/** VIS-10 à VIS-12, VIS-17, VIS-20, GFT-09, GFT-10, WSH-04, LST-19. */
export function itemAccess(access: ListAccess, item: ItemFacts, viewerId: string): ItemAccess {
  if (item.status === 'WITHDRAWN') return 'none'; // LST-19
  switch (access.kind) {
    case 'none':
      return 'none';
    case 'recipient':
      if (item.isSuggestion) return 'none'; // WSH-04, VIS-20
      if (item.addedBy === viewerId) return 'recipient'; // « c'est le sien »
      return ruleExcludes(item.rule, viewerId) ? 'none' : 'recipient'; // VIS-17
    case 'gift_recipient':
      if (item.isSuggestion || access.content === 'NONE') return 'none';
      if (access.content === 'PARTIAL' && !item.shownToRecipient) return 'none';
      return ruleExcludes(item.rule, viewerId) ? 'none' : 'recipient';
    case 'giver':
      if (item.addedBy === viewerId) return 'giver';
      return ruleExcludes(item.rule, viewerId) ? 'none' : 'giver';
  }
}

/**
 * Critères de requête des éléments (VIS-31) : traduits en SQL par le dépôt, pour ne pas charger
 * ce qui sera écarté. Le moteur revérifie chaque élément chargé par `itemAccess`.
 * `null` : aucun élément.
 */
export interface ItemCriteria {
  /** Les suggestions sont-elles lues ? */
  readonly suggestions: boolean;
  /** `shown_to_recipient` exigé (giftlist en contenu partiel). */
  readonly shownOnly: boolean;
  /** Règle appliquée à ce profil, sauf pour ses propres éléments. */
  readonly ruleFor: string;
}

export function itemCriteria(access: ListAccess, viewerId: string): ItemCriteria | null {
  switch (access.kind) {
    case 'none':
      return null;
    case 'recipient':
      return { suggestions: false, shownOnly: false, ruleFor: viewerId };
    case 'gift_recipient':
      if (access.content === 'NONE') return null;
      return { suggestions: false, shownOnly: access.content === 'PARTIAL', ruleFor: viewerId };
    case 'giver':
      return { suggestions: true, shownOnly: false, ruleFor: viewerId };
  }
}

// --- Permissions d'action (LST-02, LST-03, VIS-18, WSH-07 ; ADR 0016) ---

/** LST-05, LST-20, EVT-38 : un événement clos met ses listes en lecture seule. */
function writable(list: ListFacts): boolean {
  return !list.archived && !list.deleted && !(list.event?.closed ?? false);
}

function isManager(role: ListRole | null): boolean {
  return role === 'CREATOR' || role === 'OWNER';
}

function memberRole(access: ListAccess): ListRole | null {
  return access.kind === 'recipient' || access.kind === 'giver' ? access.role : null;
}

/** Titre, description, audience, destinataires, défauts, réglages de giftlist (LST-02). */
export function canEditList(list: ListFacts, access: ListAccess): boolean {
  return writable(list) && isManager(memberRole(access));
}

/** LST-05 : archiver et désarchiver (une liste archivée n'est plus modifiable, sauf ceci). */
export function canArchiveList(list: ListFacts, access: ListAccess): boolean {
  return !list.deleted && !list.personal && isManager(memberRole(access));
}

/** LST-20 : la corbeille. */
export function canDeleteList(list: ListFacts, viewerId: string): boolean {
  return !list.personal && authorityOf(list) === viewerId;
}

export function canRestoreList(list: ListFacts, viewerId: string): boolean {
  return list.deleted && authorityOf(list) === viewerId;
}

/** LST-08. */
export function canManageMembers(list: ListFacts, access: ListAccess): boolean {
  return writable(list) && isManager(memberRole(access));
}

/** Ce qu'un profil peut ajouter à une liste. */
export type AddRight = 'none' | 'suggestion' | 'item' | 'item_or_suggestion';

/** LST-02, WSH-04, WSH-07. */
export function addRight(list: ListFacts, access: ListAccess): AddRight {
  if (!writable(list)) return 'none';
  const role = memberRole(access);
  const contributes = role === 'CREATOR' || role === 'OWNER' || role === 'CONTRIBUTOR';
  if (access.kind === 'recipient') return contributes ? 'item' : 'none';
  if (access.kind !== 'giver') return 'none';
  if (list.type === 'GIFTLIST') return contributes ? 'item' : 'none';
  return contributes ? 'item_or_suggestion' : 'suggestion';
}

/** Modifier ou retirer un élément (LST-02, WSH-07). Suppose l'élément visible. */
export function canEditItem(
  list: ListFacts,
  access: ListAccess,
  item: ItemFacts,
  viewerId: string,
): boolean {
  if (!writable(list) || itemAccess(access, item, viewerId) === 'none') return false;
  if (item.isSuggestion) return item.addedBy === viewerId;
  const role = memberRole(access);
  if (isManager(role)) return true;
  return role === 'CONTRIBUTOR' && item.addedBy === viewerId;
}

/** LST-03, VIS-14, VIS-18 : modifier la règle d'un élément. */
export function canEditItemRule(
  list: ListFacts,
  access: ListAccess,
  item: ItemFacts,
  viewerId: string,
): boolean {
  if (!writable(list) || itemAccess(access, item, viewerId) === 'none') return false;
  if (item.isSuggestion) return item.addedBy === viewerId;
  const role = memberRole(access);
  if (authorityOf(list) === viewerId) return true;
  switch (list.visibilityEditRole) {
    case 'CREATOR':
      // LST-03 : sans créateur, le droit revient au responsable.
      return role === 'OWNER' && !list.members.some((member) => member.role === 'CREATOR');
    case 'OWNER':
      return isManager(role);
    case 'CONTRIBUTOR':
      return isManager(role) || (role === 'CONTRIBUTOR' && item.addedBy === viewerId);
  }
}

/** LST-03 : la règle par défaut de la liste, et le rôle qui modifie les règles. */
export function canEditListRules(list: ListFacts, access: ListAccess, viewerId: string): boolean {
  if (!writable(list)) return false;
  const role = memberRole(access);
  if (authorityOf(list) === viewerId) return true;
  if (list.visibilityEditRole === 'CREATOR') {
    return role === 'OWNER' && !list.members.some((member) => member.role === 'CREATOR');
  }
  return isManager(role);
}

/**
 * LST-13, LST-18, GFT-11 : cocher ou décocher « reçu ». Permis sur la liste d'un événement clos
 * (EVT-38), jamais sur une liste archivée ou à la corbeille.
 */
export function canMarkReceived(
  list: ListFacts,
  access: ListAccess,
  item: ItemFacts,
  viewerId: string,
): boolean {
  if (list.archived || list.deleted) return false;
  const seen = itemAccess(access, item, viewerId);
  if (list.type === 'WISHLIST') return access.kind === 'recipient' && seen === 'recipient';
  if (access.kind === 'gift_recipient') return seen === 'recipient';
  return access.kind === 'giver' && isManager(access.role) && seen === 'giver';
}

/** EVT-29 : rattacher une liste à un événement. */
export function canAttachList(list: ListFacts, event: EventMembership, viewerId: string): boolean {
  if (list.event !== null || list.personal || list.archived || list.deleted) return false;
  if (isEventClosed(event) || authorityOf(list) !== viewerId) return false;
  if (!respondedPresent(event, viewerId)) return false;
  if (list.type === 'GIFTLIST') return true;
  const allowed = wishlistRecipientsAllowed(event);
  return list.recipients.every((recipient) => allowed.includes(recipient));
}

/** EVT-29 : détacher, par l'autorité. */
export function canDetachList(list: ListFacts, viewerId: string): boolean {
  return list.event !== null && !list.deleted && authorityOf(list) === viewerId;
}

/** LST-15 : retrait, par un destinataire d'une wishlist. */
export function canActAsRecipient(
  list: ListFacts,
  access: ListAccess,
  item: ItemFacts,
  viewerId: string,
): boolean {
  return (
    writable(list) &&
    access.kind === 'recipient' &&
    itemAccess(access, item, viewerId) === 'recipient'
  );
}

/** VIS-14 : le journal des règles est consultable par l'autorité. */
export function canReadVisibilityLog(list: ListFacts, viewerId: string): boolean {
  return authorityOf(list) === viewerId;
}

// --- Répertoire (REP-01 à REP-10, VIS-40) ---

/** Un élément qui référence une fiche partagée, vu du répertoire. */
export interface ProductReference {
  readonly rule: ItemRule;
  /** Destinataires de la liste de l'élément (GFT-10 : tous ceux d'une giftlist). */
  readonly listRecipients: readonly string[];
}

/**
 * REP-03, REP-07, REP-10 : une fiche publiée au cercle se voit d'un profil de ce cercle, sauf s'il
 * est écarté par la règle d'un élément qui la référence, ou destinataire d'un tel élément : la
 * publication ne révèle pas ce qu'on lui prépare. Le propriétaire ne se voit pas dans son répertoire.
 * Le catalogue global attend la phase 7 (REP-09).
 */
export function sharedProductVisible(input: {
  readonly viewerId: string;
  readonly ownerId: string | null;
  readonly shareLevel: 'PRIVATE' | 'CIRCLE' | 'GLOBAL';
  readonly viewerInOwnerCircle: boolean;
  readonly references: readonly ProductReference[];
}): boolean {
  if (input.shareLevel !== 'CIRCLE' || input.ownerId === null) return false;
  if (input.ownerId === input.viewerId || !input.viewerInOwnerCircle) return false;
  return input.references.every(
    (reference) =>
      !reference.listRecipients.includes(input.viewerId) &&
      !ruleExcludes(reference.rule, input.viewerId),
  );
}

/** REP-06 : publier une fiche référencée par un élément caché exige un choix explicite. */
export function requiresHiddenItemChoice(references: readonly ProductReference[]): boolean {
  return references.some((reference) => reference.rule.mode !== 'ALL');
}
