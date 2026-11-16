import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import { ProductCatalog } from '../../catalog';
import {
  type AddRight,
  addRight,
  authorityOf,
  canArchiveList,
  canAttachList,
  canDeleteList,
  canEditList,
  canEditListRules,
  canManageMembers,
  canReadVisibilityLog,
  canRestoreList,
  type GiftContent,
  type GiftExistence,
  type ListAccess,
  type ListAudience,
  type ListMemberFact,
  type ListRole,
  type ListType,
  type VisibilityEditRole,
  type VisibilityMode,
  VisibilityService,
} from '../../visibility';
import {
  CUSTOM_AUDIENCE_MAX,
  defaultAudience,
  giftSettingsConsistent,
  LIST_RECIPIENTS_MAX,
  PERSONAL_LIST_TITLE,
  textProblem,
  TRASH_RETENTION_DAYS,
} from '../domain/list';
import {
  GiftSettingsInconsistentError,
  ListActionForbiddenError,
  ListInvalidError,
  ListNotFoundError,
  ListVersionMismatchError,
  MemberNotAllowedError,
  PersonalListLockedError,
  RecipientNotAllowedError,
  SuccessorRequiredError,
} from '../domain/list.errors';
import {
  EventLookup,
  ItemRepository,
  type ListChanges,
  ListRepository,
} from '../domain/list.ports';
import { type GatedList, ListGate } from './list-gate';
import { eventForParticipant, eventRecipientPool } from './manage-event-lists.use-case';

/** Ce que le profil peut faire sur la liste (rendu au client pour l'interface ; le serveur revérifie). */
export interface ListPermissions {
  readonly edit: boolean;
  readonly archive: boolean;
  readonly delete: boolean;
  readonly restore: boolean;
  readonly manageMembers: boolean;
  readonly add: AddRight;
  readonly editRules: boolean;
  readonly readLog: boolean;
}

export interface ListSummary extends GatedList {
  readonly permissions: ListPermissions;
}

function permissionsOf(gated: GatedList, viewerId: string): ListPermissions {
  const { facts, access } = gated;
  return {
    edit: canEditList(facts, access),
    archive: canArchiveList(facts, access),
    delete: canDeleteList(facts, viewerId) && !facts.deleted,
    restore: canRestoreList(facts, viewerId),
    manageMembers: canManageMembers(facts, access),
    add: addRight(facts, access),
    editRules: canEditListRules(facts, access, viewerId),
    readLog: canReadVisibilityLog(facts, viewerId),
  };
}

export function summarize(gated: GatedList, viewerId: string): ListSummary {
  return { ...gated, permissions: permissionsOf(gated, viewerId) };
}

function roleOf(access: ListAccess): ListRole | null {
  return access.kind === 'giver' || access.kind === 'recipient' ? access.role : null;
}

/**
 * Vérifie les destinataires proposés par `actorId` (LST-07). `eventPool` : profils qu'une
 * giftlist rattachée peut viser hors du cercle (EVT-29).
 */
async function checkRecipients(
  visibility: VisibilityService,
  type: ListType,
  actorId: string,
  recipients: readonly string[],
  members: readonly string[],
  eventPool: ReadonlySet<string> = new Set(),
): Promise<void> {
  const unique = new Set(recipients);
  if (unique.size !== recipients.length || unique.size === 0 || unique.size > LIST_RECIPIENTS_MAX) {
    throw new RecipientNotAllowedError();
  }
  if (type === 'WISHLIST') {
    for (const id of unique) {
      if (id !== actorId && !(await visibility.sameAccount(actorId, id))) {
        throw new RecipientNotAllowedError();
      }
    }
    return;
  }
  const circle = new Set(await visibility.circleOf(actorId));
  for (const id of unique) {
    // GFT-01, GFT-06 : jamais soi-même ni un membre ; un profil du cercle seulement.
    if (id === actorId || members.includes(id) || !(circle.has(id) || eventPool.has(id))) {
      throw new RecipientNotAllowedError();
    }
  }
}

async function checkCustomAudience(
  visibility: VisibilityService,
  actorId: string,
  profiles: readonly string[],
): Promise<void> {
  if (new Set(profiles).size !== profiles.length || profiles.length > CUSTOM_AUDIENCE_MAX) {
    throw new ListInvalidError();
  }
  const circle = new Set(await visibility.circleOf(actorId));
  if (profiles.some((id) => !circle.has(id))) throw new ListInvalidError();
}

/** GET /lists : listes visibles, « Mes envies » d'abord créée si besoin (WSH-06). */
@Injectable()
export class ListLists {
  constructor(
    private readonly lists: ListRepository,
    private readonly gate: ListGate,
    private readonly visibility: VisibilityService,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    viewerId: string;
    scope: 'active' | 'archived' | 'trash';
    /** EVT-30 : listes rattachées à cet événement seulement. */
    eventId?: string;
  }): Promise<ListSummary[]> {
    await this.lists.ensurePersonal({
      profileId: input.viewerId,
      listId: this.ids.next(),
      memberId: this.ids.next(),
      recipientId: this.ids.next(),
      title: PERSONAL_LIST_TITLE,
    });
    const candidates =
      input.scope === 'trash'
        ? await this.lists.findTrash(input.viewerId)
        : await this.lists.findCandidates(await this.visibility.listCandidates(input.viewerId));
    const out: ListSummary[] = [];
    for (const list of candidates) {
      const gated = await this.gate.accessOf(input.viewerId, list);
      if (gated.access.kind === 'none') continue;
      if (input.eventId !== undefined && list.event?.id !== input.eventId) continue;
      const archived = list.archivedAt !== null;
      if (input.scope === 'active' && archived) continue;
      if (input.scope === 'archived' && !archived) continue;
      out.push({ ...gated, permissions: permissionsOf(gated, input.viewerId) });
    }
    return out.sort(
      (a, b) =>
        Number(b.list.personalProfileId === input.viewerId) -
          Number(a.list.personalProfileId === input.viewerId) ||
        b.list.createdAt.getTime() - a.list.createdAt.getTime(),
    );
  }
}

export interface CreateListInput {
  readonly viewerId: string;
  readonly type: ListType;
  readonly title: string;
  readonly description: string;
  readonly recipientIds: readonly string[] | null;
  readonly audience: ListAudience | null;
  readonly customAudience: readonly string[];
  readonly giftExistence: GiftExistence | null;
  readonly giftContent: GiftContent | null;
  /** EVT-29 : rattachée dès la création. */
  readonly eventId?: string | null;
}

/** POST /lists (LST-01, LST-07, VIS-02, GFT-03, GFT-04, EVT-29). */
@Injectable()
export class CreateList {
  constructor(
    private readonly lists: ListRepository,
    private readonly gate: ListGate,
    private readonly visibility: VisibilityService,
    private readonly lookup: EventLookup,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: CreateListInput): Promise<ListSummary> {
    if (textProblem(input.title, input.description)) throw new ListInvalidError();
    const recipients = input.recipientIds ?? (input.type === 'WISHLIST' ? [input.viewerId] : []);
    const event = input.eventId
      ? await eventForParticipant(this.lookup, input.eventId, input.viewerId)
      : null;
    if (event) {
      // EVT-29 : mêmes conditions qu'un rattachement, jugées par le moteur sur la liste à naître.
      const draft = {
        id: '',
        type: input.type,
        audience: 'MEMBERS' as const,
        recipients,
        members: [{ profileId: input.viewerId, role: 'CREATOR' as const, since: new Date(0) }],
        customAudience: [],
        visibilityEditRole: 'CREATOR' as const,
        giftExistence: 'HIDDEN' as const,
        giftContent: 'NONE' as const,
        personal: false,
        archived: false,
        deleted: false,
        event: null,
      };
      if (!canAttachList(draft, event, input.viewerId)) throw new ListActionForbiddenError();
    }
    await checkRecipients(
      this.visibility,
      input.type,
      input.viewerId,
      recipients,
      [input.viewerId],
      event ? await eventRecipientPool(this.lookup, event) : new Set(),
    );
    // VIS-02 : wishlist d'événement = `EVENT` ; `EVENT` exige un événement.
    const audience =
      input.audience ??
      (event && input.type === 'WISHLIST' ? 'EVENT' : defaultAudience(input.type));
    if (audience === 'EVENT' && !event) throw new ListInvalidError();
    const custom = audience === 'CUSTOM' ? input.customAudience : [];
    await checkCustomAudience(this.visibility, input.viewerId, custom);
    if (input.type === 'WISHLIST' && (input.giftExistence || input.giftContent)) {
      throw new ListInvalidError();
    }
    const existence = input.giftExistence ?? 'HIDDEN';
    const content = input.giftContent ?? 'NONE';
    if (!giftSettingsConsistent(existence, content)) throw new GiftSettingsInconsistentError();
    const list = await this.lists.create({
      id: this.ids.next(),
      eventId: event?.id ?? null,
      type: input.type,
      title: input.title.trim(),
      description: input.description,
      creatorProfileId: input.viewerId,
      creatorMemberId: this.ids.next(),
      personal: false,
      audience,
      recipients: recipients.map((profileId) => ({ id: this.ids.next(), profileId })),
      customAudience: custom.map((profileId) => ({ id: this.ids.next(), profileId })),
      giftExistence: existence,
      giftContent: content,
    });
    // WSH-02 : les autres destinataires d'une wishlist en sont contributeurs.
    if (input.type === 'WISHLIST') {
      for (const profileId of recipients.filter((id) => id !== input.viewerId)) {
        await this.lists.setMember({
          listId: list.id,
          id: this.ids.next(),
          profileId,
          role: 'CONTRIBUTOR',
        });
      }
    }
    const fresh = await this.gate.list(input.viewerId, list.id);
    return { ...fresh, permissions: permissionsOf(fresh, input.viewerId) };
  }
}

/** GET /lists/{id} */
@Injectable()
export class GetList {
  constructor(private readonly gate: ListGate) {}

  async execute(input: { viewerId: string; listId: string }): Promise<ListSummary> {
    const gated = await this.gate.list(input.viewerId, input.listId);
    return { ...gated, permissions: permissionsOf(gated, input.viewerId) };
  }
}

export interface UpdateListInput {
  readonly viewerId: string;
  readonly listId: string;
  readonly expectedVersion: number;
  readonly title?: string;
  readonly description?: string;
  readonly audience?: ListAudience;
  readonly customAudience?: readonly string[];
  readonly recipientIds?: readonly string[];
  readonly defaultItemVisibility?: VisibilityMode;
  readonly visibilityEditRole?: VisibilityEditRole;
  readonly giftExistence?: GiftExistence;
  readonly giftContent?: GiftContent;
  readonly archived?: boolean;
}

/** PATCH /lists/{id} (LST-02, LST-03, LST-05, LST-07, GFT-03, GFT-04). */
@Injectable()
export class UpdateList {
  constructor(
    private readonly lists: ListRepository,
    private readonly items: ItemRepository,
    private readonly catalog: ProductCatalog,
    private readonly gate: ListGate,
    private readonly visibility: VisibilityService,
    private readonly lookup: EventLookup,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: UpdateListInput): Promise<ListSummary> {
    const gated = await this.gate.list(input.viewerId, input.listId);
    const { list, facts, access } = gated;
    const personal = list.personalProfileId !== null;

    const onlyArchive =
      input.archived !== undefined &&
      Object.keys(input).every((key) =>
        ['viewerId', 'listId', 'expectedVersion', 'archived'].includes(key),
      );
    if (input.archived !== undefined) {
      if (personal) throw new PersonalListLockedError();
      if (!canArchiveList(facts, access)) throw new ListActionForbiddenError();
    }
    if (!onlyArchive && !canEditList(facts, access)) throw new ListActionForbiddenError();

    if (textProblem(input.title, input.description)) throw new ListInvalidError();
    // LST-03 : la règle par défaut suit le droit de modifier les règles ; le rôle délégué, l'autorité.
    if (
      input.defaultItemVisibility !== undefined &&
      !canEditListRules(facts, access, input.viewerId)
    ) {
      throw new ListActionForbiddenError();
    }
    if (input.visibilityEditRole !== undefined && authorityOf(facts) !== input.viewerId) {
      throw new ListActionForbiddenError();
    }
    if (input.recipientIds !== undefined) {
      if (personal) throw new PersonalListLockedError();
      // LST-07 (revue SEC-40, B1) : un destinataire ne se retire jamais ; il deviendrait offreur
      // de ce qu'on lui prépare.
      if (list.recipients.some((id) => !input.recipientIds?.includes(id))) {
        throw new RecipientNotAllowedError();
      }
      const unique = new Set(input.recipientIds);
      if (unique.size !== input.recipientIds.length || unique.size > LIST_RECIPIENTS_MAX) {
        throw new RecipientNotAllowedError();
      }
      const added = [...unique].filter((id) => !list.recipients.includes(id));
      if (list.type === 'WISHLIST') {
        // Contrôle contre le compte des destinataires, pas contre celui de l'auteur du changement.
        const anchor = list.recipients[0];
        for (const id of added) {
          if (!anchor || !(await this.visibility.sameAccount(anchor, id))) {
            throw new RecipientNotAllowedError();
          }
        }
      } else if (added.length > 0) {
        // EVT-29 : rattachée, la giftlist peut viser les honorés ou participants de l'événement.
        const found = list.event ? await this.lookup.find(list.event.id) : null;
        const event = found?.participants.some((p) => p.profileId === input.viewerId)
          ? found
          : null;
        await checkRecipients(
          this.visibility,
          list.type,
          input.viewerId,
          added,
          list.members.map((member) => member.profileId),
          event ? await eventRecipientPool(this.lookup, event) : new Set(),
        );
      }
    }
    // VIS-03 : `EVENT` n'a de sens que rattachée.
    if (input.audience === 'EVENT' && !list.event) throw new ListInvalidError();
    const audience = input.audience ?? list.audience;
    if (input.customAudience !== undefined) {
      await checkCustomAudience(this.visibility, input.viewerId, input.customAudience);
    }
    const giftTouched = input.giftExistence !== undefined || input.giftContent !== undefined;
    if (giftTouched && list.type !== 'GIFTLIST') throw new ListInvalidError();
    if (
      !giftSettingsConsistent(
        input.giftExistence ?? list.giftExistence,
        input.giftContent ?? list.giftContent,
      )
    ) {
      throw new GiftSettingsInconsistentError();
    }

    const changes: ListChanges = {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.audience !== undefined ? { audience: input.audience } : {}),
      ...(input.defaultItemVisibility !== undefined
        ? { defaultItemVisibility: input.defaultItemVisibility }
        : {}),
      ...(input.visibilityEditRole !== undefined
        ? { visibilityEditRole: input.visibilityEditRole }
        : {}),
      ...(input.giftExistence !== undefined ? { giftExistence: input.giftExistence } : {}),
      ...(input.giftContent !== undefined ? { giftContent: input.giftContent } : {}),
      ...(input.archived !== undefined ? { archived: input.archived } : {}),
      ...(input.recipientIds !== undefined
        ? {
            recipients: input.recipientIds.map((profileId) => ({ id: this.ids.next(), profileId })),
          }
        : {}),
      ...(input.customAudience !== undefined || audience !== 'CUSTOM'
        ? {
            customAudience:
              audience === 'CUSTOM'
                ? (input.customAudience ?? list.customAudience).map((profileId) => ({
                    id: this.ids.next(),
                    profileId,
                  }))
                : [],
          }
        : {}),
    };
    const now = this.clock.now();
    const newDefault =
      input.defaultItemVisibility !== list.defaultItemVisibility
        ? input.defaultItemVisibility
        : undefined;
    const result = await this.lists.update({
      listId: list.id,
      expectedVersion: input.expectedVersion,
      changes,
      now,
      // VIS-14 : la règle par défaut de la liste est tracée comme celle d'un élément.
      ...(newDefault
        ? {
            log: {
              id: this.ids.next(),
              listId: list.id,
              itemId: null,
              changedBy: input.viewerId,
              before: { mode: list.defaultItemVisibility, profiles: [] },
              after: { mode: newDefault, profiles: [] },
              at: now,
            },
          }
        : {}),
    });
    if (result === 'missing') throw new ListNotFoundError();
    if (result === 'version') throw new ListVersionMismatchError();
    if (list.type === 'WISHLIST' && input.recipientIds) {
      const members = new Set(list.members.map((member) => member.profileId));
      for (const profileId of input.recipientIds.filter((id) => !members.has(id))) {
        await this.lists.setMember({
          listId: list.id,
          id: this.ids.next(),
          profileId,
          role: 'CONTRIBUTOR',
        });
      }
    }
    // REP-10 (revue SEC-40, R2) : un destinataire ajouté ne voit pas disparaître de son répertoire
    // une fiche publiée que la liste référence : l'élément passe sur une copie privée.
    if (input.recipientIds && input.recipientIds.some((id) => !list.recipients.includes(id))) {
      for (const { itemId, productId } of await this.items.productsOfList(list.id)) {
        const product = await this.catalog.findById(productId);
        if (!product || product.shareLevel === 'PRIVATE' || !product.ownerProfileId) continue;
        const copy = await this.catalog.copy(product.id, product.ownerProfileId);
        await this.items.repointProduct(itemId, copy.id);
      }
    }
    const fresh = await this.gate.list(input.viewerId, list.id);
    return { ...fresh, permissions: permissionsOf(fresh, input.viewerId) };
  }
}

/** DELETE /lists/{id} : à la corbeille pour 30 jours (LST-05, LST-20). */
@Injectable()
export class DeleteList {
  constructor(
    private readonly lists: ListRepository,
    private readonly gate: ListGate,
    private readonly clock: Clock,
  ) {}

  async execute(input: { viewerId: string; listId: string }): Promise<void> {
    const { list, facts } = await this.gate.list(input.viewerId, input.listId);
    if (list.personalProfileId !== null) throw new PersonalListLockedError();
    if (list.deletedAt !== null) throw new ListNotFoundError();
    if (!canDeleteList(facts, input.viewerId)) throw new ListActionForbiddenError();
    await this.lists.trash(list.id, this.clock.now());
  }
}

/** POST /lists/{id}/restore (LST-20). */
@Injectable()
export class RestoreList {
  constructor(
    private readonly lists: ListRepository,
    private readonly gate: ListGate,
  ) {}

  async execute(input: { viewerId: string; listId: string }): Promise<ListSummary> {
    const { list, facts } = await this.gate.list(input.viewerId, input.listId);
    if (!canRestoreList(facts, input.viewerId)) throw new ListActionForbiddenError();
    await this.lists.restore(list.id);
    const fresh = await this.gate.list(input.viewerId, list.id);
    return { ...fresh, permissions: permissionsOf(fresh, input.viewerId) };
  }
}

/** LST-20 : purge quotidienne de la corbeille. */
@Injectable()
export class PurgeListTrash {
  constructor(
    private readonly lists: ListRepository,
    private readonly clock: Clock,
  ) {}

  execute(): Promise<number> {
    const before = new Date(this.clock.now().getTime() - TRASH_RETENTION_DAYS * 24 * 3600_000);
    return this.lists.purgeTrash(before);
  }
}

/** GET /lists/{id}/members : jamais au destinataire d'une giftlist (GFT-09). */
@Injectable()
export class ListMembers {
  constructor(private readonly gate: ListGate) {}

  async execute(input: { viewerId: string; listId: string }): Promise<readonly ListMemberFact[]> {
    const { list, access } = await this.gate.list(input.viewerId, input.listId);
    if (access.kind === 'gift_recipient') throw new ListNotFoundError();
    return list.members;
  }
}

/** PUT /lists/{id}/members/{profileId} (LST-08). */
@Injectable()
export class SetListMember {
  constructor(
    private readonly lists: ListRepository,
    private readonly gate: ListGate,
    private readonly visibility: VisibilityService,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    viewerId: string;
    listId: string;
    profileId: string;
    role: Exclude<ListRole, 'CREATOR'>;
  }): Promise<void> {
    const { list, facts, access } = await this.gate.list(input.viewerId, input.listId);
    if (!canManageMembers(facts, access)) throw new ListActionForbiddenError();
    const current = list.members.find((member) => member.profileId === input.profileId);
    if (current?.role === 'CREATOR' || input.profileId === input.viewerId) {
      throw new MemberNotAllowedError();
    }
    if (list.type === 'GIFTLIST' && list.recipients.includes(input.profileId)) {
      throw new MemberNotAllowedError();
    }
    // LNK-04 : un membre se choisit dans son cercle (un membre déjà présent garde sa place).
    if (!current && !(await this.visibility.circleOf(input.viewerId)).includes(input.profileId)) {
      throw new MemberNotAllowedError();
    }
    await this.lists.setMember({
      listId: list.id,
      id: this.ids.next(),
      profileId: input.profileId,
      role: input.role,
    });
  }
}

/** DELETE /lists/{id}/members/{profileId} (LST-08). */
@Injectable()
export class RemoveListMember {
  constructor(
    private readonly lists: ListRepository,
    private readonly gate: ListGate,
  ) {}

  async execute(input: { viewerId: string; listId: string; profileId: string }): Promise<void> {
    const { list, facts, access } = await this.gate.list(input.viewerId, input.listId);
    if (!canManageMembers(facts, access)) throw new ListActionForbiddenError();
    const target = list.members.find((member) => member.profileId === input.profileId);
    if (!target) throw new MemberNotAllowedError();
    if (target.role === 'CREATOR') throw new MemberNotAllowedError();
    // WSH-01 : un destinataire d'une wishlist en reste membre.
    if (list.type === 'WISHLIST' && list.recipients.includes(input.profileId)) {
      throw new MemberNotAllowedError();
    }
    await this.lists.removeMember(list.id, input.profileId);
  }
}

/** POST /lists/{id}/leave (LST-04). */
@Injectable()
export class LeaveList {
  constructor(
    private readonly lists: ListRepository,
    private readonly gate: ListGate,
  ) {}

  async execute(input: {
    viewerId: string;
    listId: string;
    successorId: string | null;
  }): Promise<void> {
    const { list, access } = await this.gate.list(input.viewerId, input.listId);
    const role = roleOf(access);
    if (!role) throw new ListActionForbiddenError();
    if (list.personalProfileId !== null) throw new PersonalListLockedError();
    if (list.type === 'WISHLIST' && list.recipients.includes(input.viewerId)) {
      throw new PersonalListLockedError();
    }
    let successor: string | null = null;
    if (role === 'CREATOR') {
      const heir = list.members.find(
        (member) => member.profileId === input.successorId && member.profileId !== input.viewerId,
      );
      if (!heir) throw new SuccessorRequiredError();
      successor = heir.profileId;
    }
    await this.lists.leave({ listId: list.id, profileId: input.viewerId, successorId: successor });
  }
}
