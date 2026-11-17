import { z } from 'zod';
import { envelope } from './envelope';

// Écrit à la main (API-05) : un schéma par type d'événement d'API-33. Identifiants seulement (RT-08) :
// le client relit par l'API, qui filtre par le moteur.

const id = z.uuid();
const thread = z.enum(['PUBLIC', 'GIVERS']);

const itemData = z.object({ listId: id, itemId: id }).strict();
const commentData = z.object({ itemId: id, thread, commentId: id }).strict();
const presenceData = z.object({ itemId: id, profileId: id, present: z.boolean() }).strict();

export const realtimeEventSchemas = {
  'item.created': envelope('item.created', itemData),
  'item.updated': envelope('item.updated', itemData),
  'item.removed': envelope('item.removed', itemData),
  'list.updated': envelope('list.updated', z.object({ listId: id }).strict()),
  'product.extracted': envelope('product.extracted', z.object({ productId: id }).strict()),
  'comment.created': envelope('comment.created', commentData),
  'comment.updated': envelope('comment.updated', commentData),
  'comment.deleted': envelope('comment.deleted', commentData),
  'presence.changed': envelope('presence.changed', presenceData),
  typing: envelope('typing', presenceData),
  'notification.created': envelope(
    'notification.created',
    z.object({ notificationId: id, seq: z.number().int().positive() }).strict(),
  ),
  'access.revoked': envelope('access.revoked', z.object({ room: z.string().max(80) }).strict()),
  'event.updated': envelope('event.updated', z.object({ eventId: id }).strict()),
  // CPT-59 : salon des offreurs seulement ; le client relit la compta par l'API.
  'accounting.changed': envelope('accounting.changed', z.object({ itemId: id }).strict()),
} as const;

export type RealtimeEventType = keyof typeof realtimeEventSchemas;
export type RealtimeEvent = {
  [K in RealtimeEventType]: z.infer<(typeof realtimeEventSchemas)[K]>;
}[RealtimeEventType];

/** Lit une trame ; `null` pour un type inconnu ou une forme non conforme (ignorée). */
export function parseRealtimeEvent(frame: unknown): RealtimeEvent | null {
  const type = (frame as { type?: unknown } | null)?.type;
  if (typeof type !== 'string' || !(type in realtimeEventSchemas)) return null;
  const result = realtimeEventSchemas[type as RealtimeEventType].safeParse(frame);
  return result.success ? result.data : null;
}

/** Salons (RT-02, RT-03, RT-09). */
export const rooms = {
  profile: (profileId: string) => `profile:${profileId}`,
  list: (listId: string) => `list:${listId}`,
  event: (eventId: string) => `event:${eventId}`,
  itemPublic: (itemId: string) => `item:${itemId}:public`,
  itemGivers: (itemId: string) => `item:${itemId}:givers`,
} as const;

/** API-36 : messages du client. */
export type ClientMessage =
  | { readonly name: 'subscribe' | 'unsubscribe'; readonly payload: { room: string } }
  | { readonly name: 'presence'; readonly payload: { itemId: string; present: boolean } }
  | { readonly name: 'typing'; readonly payload: { itemId: string } };
