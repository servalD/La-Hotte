// Salons de la passerelle temps réel (RT-02, RT-03, RT-09 ; API-31). Noms du protocole en anglais.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROOM = new RegExp(`^(profile|list|event):(${UUID})$|^item:(${UUID}):(public|givers)$`);

export type Room =
  | { readonly kind: 'profile'; readonly id: string }
  | { readonly kind: 'list'; readonly id: string }
  | { readonly kind: 'event'; readonly id: string }
  | { readonly kind: 'item'; readonly id: string; readonly thread: 'PUBLIC' | 'GIVERS' };

/** `null` pour toute autre forme (ignorée, API-36). */
export function parseRoom(name: unknown): Room | null {
  if (typeof name !== 'string' || name.length > 80) return null;
  const match = ROOM.exec(name);
  if (!match) return null;
  const [, kind, id, itemId, thread] = match;
  if (kind && id) return { kind: kind as 'profile' | 'list' | 'event', id };
  if (itemId && thread) {
    return { kind: 'item', id: itemId, thread: thread === 'public' ? 'PUBLIC' : 'GIVERS' };
  }
  return null;
}

export function roomName(room: Room): string {
  return room.kind === 'item'
    ? `item:${room.id}:${room.thread === 'PUBLIC' ? 'public' : 'givers'}`
    : `${room.kind}:${room.id}`;
}

/** Message serveur (API-32) : un type, son salon, des identifiants seulement (RT-08). */
export interface ServerMessage {
  readonly type: string;
  readonly room: string;
  readonly data: Readonly<Record<string, string | number | boolean | null>>;
  readonly seq?: number;
}

/** Une socket, vue de l'application (locale ou d'une autre instance). */
export interface SocketHandle {
  readonly id: string;
  readonly sessionId: string;
  readonly profileId: string;
  readonly rooms: ReadonlySet<string>;
  send(message: ServerMessage): void;
  leave(room: string): void;
  disconnect(): void;
}

/** Annuaire des sockets de toutes les instances (adaptateur Redis), fourni par la passerelle. */
export abstract class SocketDirectory {
  /** Le serveur Socket.IO, confié par la passerelle à son initialisation. */
  abstract attach(server: unknown): void;
  /** Poignée d'une socket du serveur ; `null` si elle n'est pas authentifiée. */
  abstract handle(socket: unknown): SocketHandle | null;
  abstract socketsIn(room: string): Promise<SocketHandle[]>;
  abstract allSockets(): Promise<SocketHandle[]>;
}

/** API-36 : messages du client au-delà desquels la socket est fermée. */
export const CLIENT_MESSAGES_PER_SECOND = 20;
/** API-36 (revue SEC-40, M7) : connexions ouvertes par session. */
export const SOCKETS_PER_SESSION = 8;
