import type { ItemActivity, ItemChanged, ListChanged } from '../../../shared/domain';

// Événements de domaine publiés par `lists` après l'écriture validée (ADR 0018, API-35).

export function itemChanged(input: {
  listId: string;
  itemId: string;
  change: ItemChanged['change'];
  actorId: string | null;
  audience?: ItemChanged['audience'];
  activity?: ItemActivity | null;
  accessChanged?: boolean;
}): ItemChanged {
  return {
    type: 'item.changed',
    listId: input.listId,
    itemId: input.itemId,
    change: input.change,
    audience: input.audience ?? 'all',
    actorId: input.actorId,
    activity: input.activity ?? null,
    accessChanged: input.accessChanged ?? false,
  };
}

export function listChanged(listId: string, accessChanged: boolean): ListChanged {
  return { type: 'list.changed', listId, accessChanged };
}
