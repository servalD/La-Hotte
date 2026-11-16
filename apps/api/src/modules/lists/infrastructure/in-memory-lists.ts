import {
  type ItemCriteria,
  type ItemRecord,
  type ListCandidateCriteria,
  type ListRole,
  ruleExcludes,
} from '../../visibility';
import type { ItemChanges, ItemSort, ListRecord, WithdrawnReason } from '../domain/list';
import {
  EngagementReader,
  ItemRepository,
  type ItemProductReference,
  type ListChanges,
  ListRepository,
  type NewItem,
  type NewList,
  type RuleLogEntry,
  type RuleSnapshot,
  VisibilityLogRepository,
} from '../domain/list.ports';

/** VIS-14 : journal partagé par les doubles des listes et des éléments. */
export class InMemoryVisibilityLog extends VisibilityLogRepository {
  readonly entries: RuleLogEntry[] = [];

  listFor(listId: string, limit: number): Promise<RuleLogEntry[]> {
    return Promise.resolve(
      this.entries
        .filter((entry) => entry.listId === listId)
        .reverse()
        .slice(0, limit),
    );
  }
}

/** VIS-16 : engagements posés par les tests (phase 5 : la compta). */
export class InMemoryEngagementReader extends EngagementReader {
  readonly engaged = new Map<string, string[]>();

  engagedProfiles(itemId: string): Promise<string[]> {
    return Promise.resolve(this.engaged.get(itemId) ?? []);
  }
}

type StoredList = ListRecord & { creatorProfileId: string | null };

/** Double de test : même comportement observable que l'adaptateur Prisma. */
export class InMemoryListRepository extends ListRepository {
  readonly lists = new Map<string, StoredList>();
  private tick = 0;

  constructor(private readonly log: InMemoryVisibilityLog) {
    super();
  }

  private stamp(): Date {
    this.tick += 1;
    return new Date(Date.UTC(2026, 10, 1) + this.tick * 1000);
  }

  ensurePersonal(input: { profileId: string; listId: string; title: string }): Promise<void> {
    if ([...this.lists.values()].some((l) => l.personalProfileId === input.profileId)) {
      return Promise.resolve();
    }
    const at = this.stamp();
    this.lists.set(input.listId, {
      id: input.listId,
      type: 'WISHLIST',
      title: input.title,
      description: '',
      creatorProfileId: input.profileId,
      personalProfileId: input.profileId,
      event: null,
      audience: 'CIRCLE',
      recipients: [input.profileId],
      members: [{ profileId: input.profileId, role: 'CREATOR', since: at }],
      customAudience: [],
      defaultItemVisibility: 'ALL',
      visibilityEditRole: 'CREATOR',
      giftExistence: 'HIDDEN',
      giftContent: 'NONE',
      archivedAt: null,
      deletedAt: null,
      createdAt: at,
      version: 1,
    });
    return Promise.resolve();
  }

  create(list: NewList): Promise<ListRecord> {
    const at = this.stamp();
    const row: StoredList = {
      id: list.id,
      type: list.type,
      title: list.title,
      description: list.description,
      creatorProfileId: list.creatorProfileId,
      personalProfileId: list.personal ? list.creatorProfileId : null,
      event: null,
      audience: list.audience,
      recipients: list.recipients.map((r) => r.profileId),
      members: [{ profileId: list.creatorProfileId, role: 'CREATOR', since: at }],
      customAudience: list.customAudience.map((a) => a.profileId),
      defaultItemVisibility: 'ALL',
      visibilityEditRole: 'CREATOR',
      giftExistence: list.giftExistence,
      giftContent: list.giftContent,
      archivedAt: null,
      deletedAt: null,
      createdAt: at,
      version: 1,
    };
    this.lists.set(row.id, row);
    return Promise.resolve(row);
  }

  find(listId: string): Promise<ListRecord | null> {
    return Promise.resolve(this.lists.get(listId) ?? null);
  }

  findCandidates(criteria: ListCandidateCriteria): Promise<ListRecord[]> {
    const viewer = criteria.viewerId;
    return Promise.resolve(
      [...this.lists.values()]
        .filter(
          (l) =>
            l.deletedAt === null &&
            (l.members.some((m) => m.profileId === viewer) ||
              l.recipients.includes(viewer) ||
              (l.audience === 'CIRCLE' && l.recipients.some((r) => criteria.circle.includes(r))) ||
              (l.audience === 'CUSTOM' && l.customAudience.includes(viewer))),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    );
  }

  findTrash(profileId: string): Promise<ListRecord[]> {
    return Promise.resolve(
      [...this.lists.values()].filter(
        (l) =>
          l.deletedAt !== null &&
          l.members.some(
            (m) => m.profileId === profileId && (m.role === 'CREATOR' || m.role === 'OWNER'),
          ),
      ),
    );
  }

  update(input: {
    listId: string;
    expectedVersion: number;
    changes: ListChanges;
    now: Date;
    log?: RuleLogEntry;
  }): Promise<ListRecord | 'version' | 'missing'> {
    const row = this.lists.get(input.listId);
    if (!row) return Promise.resolve('missing');
    if (row.version !== input.expectedVersion) return Promise.resolve('version');
    if (input.log) this.log.entries.push(input.log);
    const { changes } = input;
    const next: StoredList = {
      ...row,
      ...(changes.title !== undefined ? { title: changes.title } : {}),
      ...(changes.description !== undefined ? { description: changes.description } : {}),
      ...(changes.audience !== undefined ? { audience: changes.audience } : {}),
      ...(changes.defaultItemVisibility !== undefined
        ? { defaultItemVisibility: changes.defaultItemVisibility }
        : {}),
      ...(changes.visibilityEditRole !== undefined
        ? { visibilityEditRole: changes.visibilityEditRole }
        : {}),
      ...(changes.giftExistence !== undefined ? { giftExistence: changes.giftExistence } : {}),
      ...(changes.giftContent !== undefined ? { giftContent: changes.giftContent } : {}),
      ...(changes.archived !== undefined
        ? { archivedAt: changes.archived ? input.now : null }
        : {}),
      ...(changes.recipients ? { recipients: changes.recipients.map((r) => r.profileId) } : {}),
      ...(changes.customAudience
        ? { customAudience: changes.customAudience.map((a) => a.profileId) }
        : {}),
      version: row.version + 1,
    };
    this.lists.set(row.id, next);
    return Promise.resolve(next);
  }

  setMember(input: {
    listId: string;
    profileId: string;
    role: Exclude<ListRole, 'CREATOR'>;
  }): Promise<void> {
    const row = this.lists.get(input.listId);
    if (!row) return Promise.resolve();
    const existing = row.members.find((m) => m.profileId === input.profileId);
    const members = existing
      ? row.members.map((m) => (m.profileId === input.profileId ? { ...m, role: input.role } : m))
      : [...row.members, { profileId: input.profileId, role: input.role, since: this.stamp() }];
    this.lists.set(row.id, { ...row, members });
    return Promise.resolve();
  }

  removeMember(listId: string, profileId: string): Promise<boolean> {
    const row = this.lists.get(listId);
    const target = row?.members.find((m) => m.profileId === profileId && m.role !== 'CREATOR');
    if (!row || !target) return Promise.resolve(false);
    this.lists.set(listId, { ...row, members: row.members.filter((m) => m !== target) });
    return Promise.resolve(true);
  }

  leave(input: { listId: string; profileId: string; successorId: string | null }): Promise<void> {
    const row = this.lists.get(input.listId);
    if (!row) return Promise.resolve();
    const members = row.members
      .filter((m) => m.profileId !== input.profileId)
      .map((m) => (m.profileId === input.successorId ? { ...m, role: 'OWNER' as const } : m));
    this.lists.set(row.id, {
      ...row,
      members,
      creatorProfileId: input.successorId ? null : row.creatorProfileId,
      version: row.version + 1,
    });
    return Promise.resolve();
  }

  trash(listId: string, at: Date): Promise<void> {
    const row = this.lists.get(listId);
    if (row && row.deletedAt === null && row.personalProfileId === null) {
      this.lists.set(listId, { ...row, deletedAt: at, version: row.version + 1 });
    }
    return Promise.resolve();
  }

  restore(listId: string): Promise<void> {
    const row = this.lists.get(listId);
    if (row && row.deletedAt !== null) {
      this.lists.set(listId, { ...row, deletedAt: null, version: row.version + 1 });
    }
    return Promise.resolve();
  }

  purgeTrash(before: Date): Promise<number> {
    let count = 0;
    for (const row of [...this.lists.values()]) {
      if (row.deletedAt && row.deletedAt < before) {
        this.lists.delete(row.id);
        count += 1;
      }
    }
    return Promise.resolve(count);
  }
}

interface StoredItem {
  readonly id: string;
  readonly listId: string;
  readonly productId: string;
  readonly addedBy: string | null;
  readonly quantity: number;
  readonly unitPriceMinor: number | null;
  readonly currency: string;
  readonly priority: ItemRecord['priority'];
  readonly note: string;
  readonly manyWelcome: boolean;
  readonly position: number;
  readonly visibilityMode: ItemRecord['visibilityMode'];
  readonly visibilityProfiles: readonly string[];
  readonly status: ItemRecord['status'];
  readonly withdrawnReason: WithdrawnReason | null;
  readonly isSuggestion: boolean;
  readonly shownToRecipient: boolean;
  readonly receivedAt: Date | null;
  readonly intendedRecipientId: string | null;
  readonly carriedFromItemId: string | null;
  readonly createdAt: Date;
  readonly version: number;
}

/** Fiches lues par le double (le double de catalog en a la forme). */
export interface ProductRows {
  readonly rows: ReadonlyMap<
    string,
    {
      readonly title: string;
      readonly description: string;
      readonly imageKey: string | null;
      readonly merchant: string | null;
      readonly sourceUrl: string | null;
    }
  >;
}

const PRIORITY_RANK = { WANT: 0, LOVE: 1, MUST: 2 } as const;

export class InMemoryItemRepository extends ItemRepository {
  readonly items = new Map<string, StoredItem>();
  private tick = 0;

  /** Destinataires d'une liste, lus dans le double des listes (relié par le banc de test). */
  recipientsOf: (listId: string) => readonly string[] = () => [];
  /** EVT-28 : événement d'une liste (relié par le banc de test). */
  eventOfList: (listId: string) => { id: string; title: string; date: string } | null = () => null;

  constructor(
    private readonly products: ProductRows,
    private readonly log: InMemoryVisibilityLog,
  ) {
    super();
  }

  productsOfList(listId: string): Promise<{ itemId: string; productId: string }[]> {
    return Promise.resolve(
      [...this.items.values()]
        .filter((row) => row.listId === listId)
        .map((row) => ({ itemId: row.id, productId: row.productId })),
    );
  }

  repointProduct(itemId: string, productId: string): Promise<void> {
    const row = this.items.get(itemId);
    if (row) this.items.set(itemId, { ...row, productId });
    return Promise.resolve();
  }

  referencesOf(productIds: readonly string[]): Promise<ItemProductReference[]> {
    return Promise.resolve(
      [...this.items.values()]
        .filter((row) => productIds.includes(row.productId) && row.status !== 'WITHDRAWN')
        .map((row) => ({
          productId: row.productId,
          itemId: row.id,
          version: row.version,
          rule: { mode: row.visibilityMode, profiles: row.visibilityProfiles },
          listRecipients: this.recipientsOf(row.listId),
        })),
    );
  }

  private record(row: StoredItem): ItemRecord {
    const product = this.products.rows.get(row.productId);
    return {
      id: row.id,
      listId: row.listId,
      product: {
        id: row.productId,
        title: product?.title ?? '',
        description: product?.description ?? '',
        imageKey: product?.imageKey ?? null,
        merchant: product?.merchant ?? null,
        sourceUrl: product?.sourceUrl ?? null,
      },
      quantity: row.quantity,
      unitPriceMinor: row.unitPriceMinor,
      currency: row.currency,
      priority: row.priority,
      note: row.note,
      manyWelcome: row.manyWelcome,
      position: row.position,
      visibilityMode: row.visibilityMode,
      visibilityProfiles: row.visibilityProfiles,
      status: row.status,
      isSuggestion: row.isSuggestion,
      shownToRecipient: row.shownToRecipient,
      receivedAt: row.receivedAt,
      addedBy: row.addedBy,
      intendedRecipientId: row.intendedRecipientId,
      createdAt: row.createdAt,
      version: row.version,
      carriedForward: [...this.items.values()].some((other) => other.carriedFromItemId === row.id),
      carryOrigin: this.carryOrigin(row),
    };
  }

  private carryOrigin(row: StoredItem): ItemRecord['carryOrigin'] {
    const origin = row.carriedFromItemId ? this.items.get(row.carriedFromItemId) : undefined;
    if (!origin) return null;
    return { status: origin.status, event: this.eventOfList(origin.listId) };
  }

  /** Réglage direct d'une règle, sans journal (préparation des tests). */
  forceRule(itemId: string, mode: ItemRecord['visibilityMode'], profiles: readonly string[]): void {
    const row = this.items.get(itemId);
    if (row) this.items.set(itemId, { ...row, visibilityMode: mode, visibilityProfiles: profiles });
  }

  /** Phase 5 : réservation et achat ; ici, pour les tests de non-fuite. */
  setStatus(itemId: string, status: ItemRecord['status']): void {
    const row = this.items.get(itemId);
    if (row) this.items.set(itemId, { ...row, status });
  }

  listItems(listId: string, criteria: ItemCriteria, sort: ItemSort): Promise<ItemRecord[]> {
    const rows = [...this.items.values()].filter(
      (row) =>
        row.listId === listId &&
        row.status !== 'WITHDRAWN' &&
        (criteria.suggestions || !row.isSuggestion) &&
        (!criteria.shownOnly || row.shownToRecipient) &&
        (row.addedBy === criteria.ruleFor ||
          !ruleExcludes(
            { mode: row.visibilityMode, profiles: row.visibilityProfiles },
            criteria.ruleFor,
          )),
    );
    const byPosition = (a: StoredItem, b: StoredItem) => a.position - b.position;
    const sorted = rows.sort((a, b) => {
      switch (sort) {
        case 'position':
          return byPosition(a, b);
        case 'priority':
          return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || byPosition(a, b);
        case 'price':
          return (
            (a.unitPriceMinor ?? Number.MAX_SAFE_INTEGER) -
              (b.unitPriceMinor ?? Number.MAX_SAFE_INTEGER) || byPosition(a, b)
          );
        case 'added':
          return b.createdAt.getTime() - a.createdAt.getTime();
      }
    });
    return Promise.resolve(sorted.map((row) => this.record(row)));
  }

  find(itemId: string): Promise<ItemRecord | null> {
    const row = this.items.get(itemId);
    return Promise.resolve(row ? this.record(row) : null);
  }

  create(item: NewItem): Promise<ItemRecord> {
    this.tick += 1;
    const positions = [...this.items.values()]
      .filter((r) => r.listId === item.listId)
      .map((r) => r.position);
    const row: StoredItem = {
      ...item,
      visibilityProfiles: [],
      position: positions.length ? Math.max(...positions) + 1 : 0,
      status: 'OPEN',
      withdrawnReason: null,
      receivedAt: null,
      carriedFromItemId: item.carriedFromItemId ?? null,
      createdAt: new Date(Date.UTC(2026, 10, 1) + this.tick * 1000),
      version: 1,
    };
    this.items.set(row.id, row);
    return Promise.resolve(this.record(row));
  }

  update(input: {
    itemId: string;
    expectedVersion: number;
    changes: ItemChanges;
  }): Promise<ItemRecord | 'version' | 'missing'> {
    const row = this.items.get(input.itemId);
    if (!row) return Promise.resolve('missing');
    if (row.version !== input.expectedVersion) return Promise.resolve('version');
    const next = { ...row, ...input.changes, version: row.version + 1 };
    this.items.set(row.id, next);
    return Promise.resolve(this.record(next));
  }

  delete(itemId: string): Promise<boolean> {
    return Promise.resolve(this.items.delete(itemId));
  }

  setRule(input: {
    itemId: string;
    expectedVersion: number;
    rule: RuleSnapshot;
    log: RuleLogEntry | null;
  }): Promise<ItemRecord | 'version' | 'missing'> {
    const row = this.items.get(input.itemId);
    if (!row) return Promise.resolve('missing');
    if (row.version !== input.expectedVersion) return Promise.resolve('version');
    const next = {
      ...row,
      visibilityMode: input.rule.mode,
      visibilityProfiles: [...input.rule.profiles],
      version: row.version + 1,
    };
    this.items.set(row.id, next);
    if (input.log) this.log.entries.push(input.log);
    return Promise.resolve(this.record(next));
  }

  setReceived(itemId: string, at: Date | null): Promise<ItemRecord | null> {
    const row = this.items.get(itemId);
    if (!row || row.status === 'WITHDRAWN') return Promise.resolve(null);
    const next = { ...row, receivedAt: at, version: row.version + 1 };
    this.items.set(itemId, next);
    return Promise.resolve(this.record(next));
  }

  withdraw(itemId: string, reason: WithdrawnReason): Promise<ItemRecord | null> {
    const row = this.items.get(itemId);
    if (!row || row.status === 'WITHDRAWN') return Promise.resolve(null);
    const next = {
      ...row,
      status: 'WITHDRAWN' as const,
      withdrawnReason: reason,
      version: row.version + 1,
    };
    this.items.set(itemId, next);
    return Promise.resolve(this.record(next));
  }
}
