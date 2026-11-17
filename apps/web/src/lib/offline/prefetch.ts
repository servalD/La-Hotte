import type { QueryClient } from '@tanstack/react-query';
import {
  EventScope,
  getGetOneEventQueryOptions,
  getListEventsQueryOptions,
  getListItemsQueryOptions,
  getListListsQueryOptions,
} from '@wishlist/api-client';

/**
 * OFF-03, OFF-09 : préchargement des événements à venir sous 30 jours, de leurs listes et de
 * leurs éléments, pour les avoir en magasin. Seulement si le navigateur ne signale ni économie de
 * données ni réseau cellulaire, et au plus une fois par heure. Les lectures passent par l'API
 * (filtrées par le moteur), puis par le coffre comme toute autre lecture.
 */
const HORIZON_MS = 30 * 24 * 60 * 60 * 1000;
const INTERVAL_MS = 60 * 60 * 1000;
let lastRun = 0;

interface NetworkInformationLike {
  readonly saveData?: boolean;
  readonly type?: string;
  readonly effectiveType?: string;
}

export function prefetchAllowed(connection: NetworkInformationLike | undefined): boolean {
  if (!connection) return true;
  if (connection.saveData) return false;
  if (connection.type === 'cellular') return false;
  return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g';
}

export async function prefetchUpcoming(
  queryClient: QueryClient,
  options: { now?: number; connection?: NetworkInformationLike; force?: boolean } = {},
): Promise<number> {
  const now = options.now ?? Date.now();
  const connection =
    options.connection ??
    (typeof navigator !== 'undefined'
      ? (navigator as Navigator & { connection?: NetworkInformationLike }).connection
      : undefined);
  if (!prefetchAllowed(connection)) return 0;
  if (!options.force && now - lastRun < INTERVAL_MS) return 0;
  lastRun = now;
  const events = await queryClient.query(getListEventsQueryOptions({ scope: EventScope.upcoming }));
  const soon = events.items.filter((event) => {
    const at = Date.parse(event.date);
    return Number.isFinite(at) && at - now <= HORIZON_MS;
  });
  let lists = 0;
  for (const event of soon) {
    await queryClient.query(getGetOneEventQueryOptions(event.id)).catch(() => undefined);
    const attached = await queryClient.query(getListListsQueryOptions({ eventId: event.id }));
    for (const list of attached.items) {
      await queryClient.query(getListItemsQueryOptions(list.id)).catch(() => undefined);
      lists += 1;
    }
  }
  return lists;
}
