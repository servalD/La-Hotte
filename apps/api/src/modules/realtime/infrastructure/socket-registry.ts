import { Injectable } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import type { SocketIdentity } from '../../identity';
import { type ServerMessage, SocketDirectory, type SocketHandle } from '../domain/rooms';

export interface SocketData {
  identity?: SocketIdentity;
  /** API-36 : messages du client dans la seconde en cours. */
  window?: { second: number; count: number };
}

/** Socket locale ou d'une autre instance ; les messages serveur sont libres (API-32). */
type AnySocket = Pick<Socket, 'id' | 'data' | 'rooms' | 'leave' | 'disconnect'> & {
  emit(event: string, payload: unknown): unknown;
};

/** Nom de l'événement Socket.IO de tous les messages serveur (API-32). */
export const SERVER_EVENT = 'message';

/**
 * Annuaire des sockets de toutes les instances (`fetchSockets`, adaptateur Redis). Le serveur lui
 * est confié par la passerelle à son initialisation.
 */
@Injectable()
export class SocketRegistry extends SocketDirectory {
  private server: Server | null = null;

  attach(server: unknown): void {
    this.server = server as Server;
  }

  handle(socket: unknown): SocketHandle | null {
    return this.handleOf(socket as AnySocket);
  }

  private handleOf(socket: AnySocket): SocketHandle | null {
    const identity = (socket.data as SocketData).identity;
    if (!identity) return null;
    return {
      id: socket.id,
      sessionId: identity.sessionId,
      profileId: identity.profileId,
      rooms: new Set(socket.rooms),
      send: (message: ServerMessage) => {
        socket.emit(SERVER_EVENT, { ...message, at: new Date().toISOString() });
      },
      leave: (room: string) => {
        void socket.leave(room);
      },
      disconnect: () => {
        socket.disconnect(true);
      },
    };
  }

  async socketsIn(room: string): Promise<SocketHandle[]> {
    if (!this.server) return [];
    return this.handles((await this.server.in(room).fetchSockets()) as unknown as AnySocket[]);
  }

  async allSockets(): Promise<SocketHandle[]> {
    if (!this.server) return [];
    return this.handles((await this.server.fetchSockets()) as unknown as AnySocket[]);
  }

  private handles(sockets: readonly AnySocket[]): SocketHandle[] {
    return sockets.flatMap((socket) => {
      const handle = this.handleOf(socket);
      return handle ? [handle] : [];
    });
  }
}
