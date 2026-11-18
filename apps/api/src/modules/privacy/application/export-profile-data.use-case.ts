import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import {
  GetBalances,
  GetCart,
  ManageBudgets,
  toBalancesView,
  toBudgetView,
  toCartView,
} from '../../accounting';
import { ListOwnProducts, toProductView } from '../../catalog';
import { CommentModerationGate } from '../../conversations';
import { type ActiveProfileValue, GetOwnProfile, SecurityLog } from '../../identity';
import { ListItems, ListLists, toItemView, toListView } from '../../lists';
import {
  DataExportNotFoundError,
  DataExportRateLimitedError,
  DataExportStore,
  EXPORT_FORMAT,
  EXPORT_INTERVAL_MS,
  EXPORT_LIFETIME_MS,
} from '../domain/data-export';

const MAX_PRODUCT_PAGES = 40;
const MAX_COMMENTS = 5000;

export interface ClientTrace {
  readonly ip: string;
  readonly userAgent: string;
}

/**
 * RGPD-04, RGPD-11 : export des données d'un profil, lu **par les lectures de l'application**, au
 * nom du profil, donc à travers le moteur de visibilité (invariant 2), et écrit avec **les mêmes
 * vues que l'API**, champ par champ : rien de ce que le profil ne voit pas, aucune donnée d'offreur
 * sur ses propres éléments (VIS-20, VIS-22).
 */
@Injectable()
export class ExportProfileData {
  constructor(
    private readonly profiles: GetOwnProfile,
    private readonly lists: ListLists,
    private readonly items: ListItems,
    private readonly products: ListOwnProducts,
    private readonly comments: CommentModerationGate,
    private readonly cart: GetCart,
    private readonly balances: GetBalances,
    private readonly budgets: ManageBudgets,
    private readonly store: DataExportStore,
    private readonly securityLog: SecurityLog,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /** Le document, tel qu'il sera téléchargé ; testé à part pour la non-fuite. */
  async build(profile: ActiveProfileValue): Promise<Record<string, unknown>> {
    const viewerId = profile.id;
    const lists = [];
    for (const scope of ['active', 'archived'] as const) {
      for (const list of await this.lists.execute({ viewerId, scope })) {
        // Une liste devenue invisible entre les deux lectures n'est pas exportée.
        const items = await this.items
          .execute({ viewerId, listId: list.list.id, sort: 'position' })
          .catch(() => null);
        if (items) lists.push({ list: toListView(list), items: items.map(toItemView) });
      }
    }
    const products = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PRODUCT_PAGES; page += 1) {
      const result = await this.products.execute({ ownerProfileId: viewerId, cursor, limit: 100 });
      products.push(...result.items.map(toProductView));
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    return {
      format: EXPORT_FORMAT,
      generatedAt: this.clock.now(),
      profile: await this.profiles.execute(profile),
      lists,
      products,
      comments: await this.comments.authoredReadable(viewerId, MAX_COMMENTS),
      cart: toCartView(await this.cart.execute(viewerId)),
      balances: toBalancesView(await this.balances.execute(viewerId, null)),
      budgets: (await this.budgets.list(viewerId, null)).map(toBudgetView),
    };
  }

  async execute(input: {
    readonly profile: ActiveProfileValue;
    readonly client: ClientTrace;
  }): Promise<{ readonly id: string; readonly expiresAt: Date }> {
    const now = this.clock.now();
    const last = await this.store.lastRequestedAt(input.profile.id);
    if (last && now.getTime() - last.getTime() < EXPORT_INTERVAL_MS) {
      const wait = EXPORT_INTERVAL_MS - (now.getTime() - last.getTime());
      throw new DataExportRateLimitedError(Math.ceil(wait / 1000));
    }
    const document = await this.build(input.profile);
    const id = this.ids.next();
    const expiresAt = new Date(now.getTime() + EXPORT_LIFETIME_MS);
    await this.store.create({
      id,
      profileId: input.profile.id,
      requestedAt: now,
      expiresAt,
      payload: JSON.stringify(document),
    });
    await this.securityLog.record({
      accountId: input.profile.accountId,
      profileId: input.profile.id,
      event: 'export.requested',
      ip: input.client.ip,
      userAgent: input.client.userAgent,
      at: now,
    });
    return { id, expiresAt };
  }
}

/** RGPD-11 : téléchargement unique, puis effacement du fichier. */
@Injectable()
export class DownloadProfileData {
  constructor(
    private readonly store: DataExportStore,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly profile: ActiveProfileValue;
    readonly exportId: string;
    readonly client: ClientTrace;
  }): Promise<string> {
    const now = this.clock.now();
    const payload = await this.store.take({
      id: input.exportId,
      profileId: input.profile.id,
      now,
    });
    if (payload === null) throw new DataExportNotFoundError();
    await this.securityLog.record({
      accountId: input.profile.accountId,
      profileId: input.profile.id,
      event: 'export.downloaded',
      ip: input.client.ip,
      userAgent: input.client.userAgent,
      at: now,
    });
    return payload;
  }
}

/** RGPD-11 : fichiers échus effacés. */
@Injectable()
export class PurgeProfileExports {
  constructor(
    private readonly store: DataExportStore,
    private readonly clock: Clock,
  ) {}

  execute(): Promise<number> {
    return this.store.purge(this.clock.now());
  }
}
