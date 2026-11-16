import { Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { AppConfig } from '../../../platform/config/env';
import { Metrics } from '../../../shared/domain';
import { SocketAuthenticator, type SocketIdentity } from '../../identity';
import {
  CLIENT_MESSAGES_PER_SECOND,
  parseRoom,
  RealtimeDispatcher,
  roomName,
  SocketDirectory,
} from '../application/contract';
/** API-36 : messages du client dans la seconde en cours ; identité posée à la poignée de main. */
interface SocketData {
  identity?: SocketIdentity;
  window?: { second: number; count: number };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function dataOf(client: Socket): SocketData {
  return client.data as SocketData;
}

/**
 * Passerelle temps réel (API-30 à API-36, RT-01 à RT-12, ADR 0006, ADR 0018). Canal descendant :
 * le client ne fait qu'abonner, désabonner, et signaler sa présence ou sa saisie.
 */
@WebSocketGateway({ path: '/realtime', serveClient: false, transports: ['websocket', 'polling'] })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly redisClients: Redis[] = [];

  constructor(
    private readonly authenticator: SocketAuthenticator,
    private readonly dispatcher: RealtimeDispatcher,
    private readonly registry: SocketDirectory,
    private readonly metrics: Metrics,
    private readonly config: AppConfig,
  ) {}

  /** API-35 : plusieurs instances partagent les salons par Redis (hors tests). */
  afterInit(server: Server): void {
    this.registry.attach(server);
    if (this.config.env.NODE_ENV === 'test') return;
    const pub = new Redis(this.config.env.REDIS_URL);
    const sub = pub.duplicate();
    for (const client of [pub, sub]) {
      client.on('error', () => undefined);
      this.redisClients.push(client);
    }
    server.adapter(createAdapter(pub, sub));
  }

  onModuleDestroy(): void {
    for (const client of this.redisClients) client.disconnect();
  }

  /** RT-01, API-30 : cookie de session, origine, profil actif déverrouillé ; sinon fermée. */
  async handleConnection(client: Socket): Promise<void> {
    const identity = await this.authenticator
      .authenticate({
        cookie: client.handshake.headers.cookie,
        origin: client.handshake.headers.origin,
      })
      .catch(() => null);
    if (!identity) {
      this.metrics.increment('wishlist.realtime_denied', { code: 'HANDSHAKE' });
      client.disconnect(true);
      return;
    }
    dataOf(client).identity = identity;
    await client.join(`profile:${identity.profileId}`);
  }

  /** API-36 : au-delà de 20 messages par seconde, la socket est fermée. */
  private throttled(client: Socket): boolean {
    const data = dataOf(client);
    const second = Math.floor(Date.now() / 1000);
    data.window =
      data.window?.second === second
        ? { second, count: data.window.count + 1 }
        : { second, count: 1 };
    if (data.window.count <= CLIENT_MESSAGES_PER_SECOND) return false;
    client.disconnect(true);
    return true;
  }

  /** API-31, RT-09 : `denied` sans distinguer l'invisible de l'inconnu. */
  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<{ ok: boolean }> {
    const identity = dataOf(client).identity;
    if (!identity || this.throttled(client)) return { ok: false };
    const room = parseRoom((body as { room?: unknown } | null)?.room);
    if (!room) return { ok: false };
    if (await this.dispatcher.canJoin(identity.profileId, room)) {
      await client.join(roomName(room));
      return { ok: true };
    }
    // Critère de 06 : un destinataire qui tente le salon d'offreurs d'un élément qu'il voit est
    // refusé et la tentative journalisée (sans identifiant de ressource, OBS-20).
    if (room.kind === 'item' && room.thread === 'GIVERS') {
      const sees = await this.dispatcher.canJoin(identity.profileId, { ...room, thread: 'PUBLIC' });
      if (sees) {
        this.logger.warn(
          { event: 'realtime.subscribe_denied', room: 'item_givers' },
          'Salon refusé',
        );
        this.metrics.increment('wishlist.realtime_denied', { code: 'GIVERS_ROOM' });
      }
    }
    return { ok: false };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    if (this.throttled(client)) return;
    const room = parseRoom((body as { room?: unknown } | null)?.room);
    if (room && room.kind !== 'profile') await client.leave(roomName(room));
  }

  /** RT-05, RT-11 */
  @SubscribeMessage('presence')
  async presence(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<void> {
    await this.relayPresence(client, body, 'presence');
  }

  @SubscribeMessage('typing')
  async typing(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<void> {
    await this.relayPresence(client, body, 'typing');
  }

  private async relayPresence(
    client: Socket,
    body: unknown,
    kind: 'presence' | 'typing',
  ): Promise<void> {
    if (this.throttled(client)) return;
    const input = body as { itemId?: unknown; present?: unknown } | null;
    const itemId = input?.itemId;
    if (typeof itemId !== 'string' || !UUID.test(itemId)) return;
    const handle = this.registry.handle(client);
    if (!handle) return;
    await this.dispatcher.presence(handle, {
      itemId,
      kind,
      present: kind === 'typing' ? true : input?.present === true,
    });
  }
}
