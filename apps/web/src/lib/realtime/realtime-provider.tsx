'use client';

import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import {
  getCountUnreadNotificationsQueryKey,
  getListNotificationsQueryKey,
  useGetSession,
} from '@wishlist/api-client';
import { parseRealtimeEvent, type RealtimeEvent } from '@wishlist/api-client/realtime';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { io, type Socket } from 'socket.io-client';

/** Une requête du cache qui mentionne cet identifiant (liste, élément, événement, fiche). */
function mentions(id: string) {
  return (query: { queryKey: readonly unknown[] }) => JSON.stringify(query.queryKey).includes(id);
}

/**
 * RT-08, RT-12 : une trame ne porte que des identifiants ; elle invalide les lectures qui les
 * mentionnent, et le client relit par l'API (qui filtre). Pas d'état parallèle au cache.
 */
export function applyRealtimeEvent(queryClient: QueryClient, event: RealtimeEvent): void {
  switch (event.type) {
    case 'item.created':
    case 'item.updated':
    case 'item.removed':
      void queryClient.invalidateQueries({ predicate: mentions(event.data.listId) });
      void queryClient.invalidateQueries({ predicate: mentions(event.data.itemId) });
      return;
    case 'list.updated':
      void queryClient.invalidateQueries({ predicate: mentions(event.data.listId) });
      return;
    case 'comment.created':
    case 'comment.updated':
    case 'comment.deleted':
      void queryClient.invalidateQueries({ predicate: mentions(event.data.itemId) });
      return;
    case 'notification.created':
      void queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getCountUnreadNotificationsQueryKey() });
      return;
    case 'event.updated':
      void queryClient.invalidateQueries({ predicate: mentions(event.data.eventId) });
      return;
    case 'product.extracted':
      void queryClient.invalidateQueries({ predicate: mentions(event.data.productId) });
      return;
    case 'access.revoked': {
      // RT-07 : les données du salon quitté sont purgées du cache local.
      const id = event.data.room.split(':')[1];
      if (id) queryClient.removeQueries({ predicate: mentions(id) });
      return;
    }
    case 'presence.changed':
    case 'typing':
      return;
  }
}

interface Realtime {
  /** RT-02 : abonne au salon tant que le composant est monté. */
  join: (room: string) => () => void;
  emit: (name: 'presence' | 'typing', payload: { itemId: string; present?: boolean }) => void;
  /** RT-05 : profils présents ou en train d'écrire, par élément (éphémère). */
  onPresence: (listener: (event: RealtimeEvent) => void) => () => void;
}

const RealtimeContext = createContext<Realtime | null>(null);

/**
 * RT-01 : un seul client Socket.IO, lié au profil actif déverrouillé, recréé quand il change. À la
 * reconnexion, les salons sont rejoints de nouveau et les lectures actives relues (RT-12).
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data } = useGetSession({ query: { staleTime: 0 } });
  const session = data?.authenticated ? data.session : null;
  const identity =
    session?.activeProfileId && session.profileUnlocked
      ? `${session.id}:${session.activeProfileId}`
      : null;
  const [socket, setSocket] = useState<Socket | null>(null);
  const rooms = useRef(new Map<string, number>());
  const listeners = useRef(new Set<(event: RealtimeEvent) => void>());

  useEffect(() => {
    if (!identity) return undefined;
    const client = io({ path: '/realtime', withCredentials: true });
    let first = true;
    client.on('connect', () => {
      for (const room of rooms.current.keys()) client.emit('subscribe', { room });
      if (!first) void queryClient.invalidateQueries({ refetchType: 'active' });
      first = false;
    });
    client.on('message', (frame: unknown) => {
      const event = parseRealtimeEvent(frame);
      if (!event) return;
      if (event.type === 'presence.changed' || event.type === 'typing') {
        for (const listener of listeners.current) listener(event);
        return;
      }
      applyRealtimeEvent(queryClient, event);
    });
    setSocket(client);
    return () => {
      client.disconnect();
      setSocket(null);
    };
  }, [identity, queryClient]);

  const join = useCallback(
    (room: string) => {
      const count = rooms.current.get(room) ?? 0;
      rooms.current.set(room, count + 1);
      if (count === 0 && socket?.connected) socket.emit('subscribe', { room });
      return () => {
        const left = (rooms.current.get(room) ?? 1) - 1;
        if (left > 0) {
          rooms.current.set(room, left);
          return;
        }
        rooms.current.delete(room);
        socket?.emit('unsubscribe', { room });
      };
    },
    [socket],
  );

  const value = useMemo<Realtime>(
    () => ({
      join,
      emit: (name, payload) => {
        socket?.emit(name, payload);
      },
      onPresence: (listener) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
    }),
    [join, socket],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

/** Sans fournisseur (tests de composants), rien n'est abonné. */
const INERT: Realtime = {
  join: () => () => undefined,
  emit: () => undefined,
  onPresence: () => () => undefined,
};

export function useRealtime(): Realtime {
  return useContext(RealtimeContext) ?? INERT;
}

/** Abonne le composant aux salons donnés, le temps de son montage. */
export function useRealtimeRooms(rooms: readonly string[]): void {
  const { join } = useRealtime();
  const key = rooms.join('|');
  useEffect(() => {
    const leaves = key
      .split('|')
      .filter(Boolean)
      .map((room) => join(room));
    return () => {
      for (const leave of leaves) leave();
    };
  }, [join, key]);
}
