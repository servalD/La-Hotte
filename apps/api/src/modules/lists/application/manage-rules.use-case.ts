import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import {
  canEditItemRule,
  canReadVisibilityLog,
  itemAccess,
  type ListFacts,
  ruleExcludes,
  type VisibilityMode,
  VisibilityService,
} from '../../visibility';
import { CUSTOM_AUDIENCE_MAX, itemFactsOf } from '../domain/list';
import {
  ItemNotFoundError,
  ListActionForbiddenError,
  ListVersionMismatchError,
  VisibilityEditForbiddenError,
} from '../domain/list.errors';
import {
  EngagementReader,
  ItemRepository,
  type RuleLogEntry,
  type RuleSnapshot,
  VisibilityLogRepository,
} from '../domain/list.ports';
import {
  VisibilityEngagedProfileError,
  VisibilityProfileInvalidError,
} from '../domain/visibility-rule.errors';
import { ListGate } from './list-gate';

export interface ItemRuleState extends RuleSnapshot {
  /** VIS-12 : profils de la règle hors de l'audience de la liste (l'interface propose de les y ajouter). */
  readonly outsideAudience: readonly string[];
  readonly version: number;
}

async function outsideAudience(
  visibility: VisibilityService,
  facts: ListFacts,
  profiles: readonly string[],
): Promise<string[]> {
  const out: string[] = [];
  for (const profileId of profiles) {
    if ((await visibility.accessToList(profileId, facts)).kind === 'none') out.push(profileId);
  }
  return out;
}

/** GET /items/{id}/visibility : la règle, lue par qui peut la modifier (VIS-19). */
@Injectable()
export class GetItemRule {
  constructor(
    private readonly gate: ListGate,
    private readonly visibility: VisibilityService,
  ) {}

  async execute(input: { viewerId: string; itemId: string }): Promise<ItemRuleState> {
    const gated = await this.gate.item(input.viewerId, input.itemId);
    if (!canEditItemRule(gated.facts, gated.access, gated.itemFacts, input.viewerId)) {
      throw new VisibilityEditForbiddenError();
    }
    const profiles = gated.item.visibilityProfiles;
    return {
      mode: gated.item.visibilityMode,
      profiles,
      outsideAudience:
        gated.item.visibilityMode === 'ONLY'
          ? await outsideAudience(this.visibility, gated.facts, profiles)
          : [],
      version: gated.item.version,
    };
  }
}

/** PUT /items/{id}/visibility (VIS-10 à VIS-16, VIS-19, LST-03, critères de 03 et 04). */
@Injectable()
export class SetItemRule {
  constructor(
    private readonly gate: ListGate,
    private readonly items: ItemRepository,
    private readonly engagements: EngagementReader,
    private readonly visibility: VisibilityService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    viewerId: string;
    itemId: string;
    expectedVersion: number;
    mode: VisibilityMode;
    profileIds: readonly string[];
  }): Promise<ItemRuleState> {
    const gated = await this.gate.item(input.viewerId, input.itemId);
    const { facts, access, item, itemFacts, list } = gated;
    if (!canEditItemRule(facts, access, itemFacts, input.viewerId)) {
      throw new VisibilityEditForbiddenError();
    }
    const profiles = input.mode === 'ALL' ? [] : [...new Set(input.profileIds)];
    if (profiles.length !== (input.mode === 'ALL' ? 0 : input.profileIds.length)) {
      throw new VisibilityProfileInvalidError();
    }
    if (profiles.length > CUSTOM_AUDIENCE_MAX) throw new VisibilityProfileInvalidError();
    // VIS-19 : le cercle de l'auteur du changement et les membres de la liste.
    const allowed = new Set([
      ...(await this.visibility.circleOf(input.viewerId)),
      ...list.members.map((member) => member.profileId),
      ...(list.type === 'WISHLIST' ? list.recipients : []),
    ]);
    if (profiles.some((id) => !allowed.has(id))) {
      throw new VisibilityProfileInvalidError();
    }
    const rule: RuleSnapshot = { mode: input.mode, profiles };
    // VIS-16 : on n'écarte pas un profil engagé sur l'élément.
    for (const engaged of await this.engagements.engagedProfiles(item.id)) {
      if (engaged !== item.addedBy && ruleExcludes(rule, engaged)) {
        throw new VisibilityEngagedProfileError();
      }
    }
    const before: RuleSnapshot = { mode: item.visibilityMode, profiles: item.visibilityProfiles };
    const log: RuleLogEntry | null = item.isSuggestion
      ? null // VIS-19 : la règle d'une suggestion n'appartient qu'à son auteur.
      : {
          id: this.ids.next(),
          listId: list.id,
          itemId: item.id,
          changedBy: input.viewerId,
          before,
          after: rule,
          at: this.clock.now(),
        };
    const result = await this.items.setRule({
      itemId: item.id,
      expectedVersion: input.expectedVersion,
      rule,
      profileRowIds: profiles.map(() => this.ids.next()),
      log,
    });
    if (result === 'missing') throw new ItemNotFoundError();
    if (result === 'version') throw new ListVersionMismatchError();
    return {
      ...rule,
      outsideAudience:
        rule.mode === 'ONLY' ? await outsideAudience(this.visibility, facts, profiles) : [],
      version: result.version,
    };
  }
}

/** GET /lists/{id}/visibility-log (VIS-14, VIS-19). */
@Injectable()
export class ReadVisibilityLog {
  constructor(
    private readonly gate: ListGate,
    private readonly log: VisibilityLogRepository,
    private readonly items: ItemRepository,
  ) {}

  async execute(input: { viewerId: string; listId: string }): Promise<RuleLogEntry[]> {
    const { facts, access } = await this.gate.list(input.viewerId, input.listId);
    if (!canReadVisibilityLog(facts, input.viewerId)) throw new ListActionForbiddenError();
    const entries = await this.log.listFor(input.listId, 200);
    const out: RuleLogEntry[] = [];
    for (const entry of entries) {
      if (entry.itemId === null) {
        out.push(entry);
        continue;
      }
      const item = await this.items.find(entry.itemId);
      // Élément supprimé : la ligne reste ; élément que le lecteur ne voit pas : elle est écartée.
      if (!item || itemAccess(access, itemFactsOf(item), input.viewerId) !== 'none')
        out.push(entry);
    }
    return out;
  }
}
