import { Injectable } from '@nestjs/common';
import type {
  AccountingChanged,
  CommentChanged,
  EventChanged,
  ItemChanged,
  ListChanged,
  NotificationCreated,
  ProductExtracted,
} from '../../../shared/domain';
import { EventAccessReader } from '../../events';
import { CheckSessionAccess } from '../../identity';
import { ItemAccessReader } from '../../lists';
import { PreferenceRepository } from '../../notifications';
import { threadLevel } from '../../visibility';
import {
  parseRoom,
  type Room,
  roomName,
  type ServerMessage,
  SocketDirectory,
  type SocketHandle,
} from '../domain/rooms';

/**
 * RT-08 à RT-10 (ADR 0018) : chaque message est émis socket par socket, après revérification de la
 * session et décision du moteur pour le profil de la socket. Les messages ne portent que des
 * identifiants ; le client relit par l'API.
 */
@Injectable()
export class RealtimeDispatcher {
  constructor(
    private readonly sockets: SocketDirectory,
    private readonly sessions: CheckSessionAccess,
    private readonly items: ItemAccessReader,
    private readonly events: EventAccessReader,
    private readonly preferences: PreferenceRepository,
  ) {}

  /** RT-02, RT-03, RT-09 : un profil peut-il rejoindre ce salon ? */
  async canJoin(profileId: string, room: Room): Promise<boolean> {
    switch (room.kind) {
      case 'profile':
        return room.id === profileId;
      case 'list':
        return (await this.items.listAccess(profileId, room.id)) !== 'none';
      case 'event':
        return (await this.events.viewers(room.id, [profileId])).has(profileId);
      case 'item': {
        const context = await this.items.forViewer(profileId, room.id);
        return context !== null && threadLevel(context.threads, room.thread) !== 'none';
      }
    }
  }

  /** Session encore valable pour ce profil ; sinon la socket est fermée (ADR 0013). */
  async alive(socket: SocketHandle): Promise<boolean> {
    if (await this.sessions.execute(socket.sessionId, socket.profileId)) return true;
    socket.disconnect();
    return false;
  }

  /** Envoie à chaque socket vivante du salon que `allowed` retient. */
  private async deliver(
    room: string,
    message: Omit<ServerMessage, 'room'>,
    allowed: (profileIds: string[]) => Promise<Set<string>>,
  ): Promise<void> {
    const sockets = await this.sockets.socketsIn(room);
    if (sockets.length === 0) return;
    const permitted = await allowed([...new Set(sockets.map((s) => s.profileId))]);
    for (const socket of sockets) {
      if (!permitted.has(socket.profileId)) continue;
      if (await this.alive(socket)) socket.send({ ...message, room });
    }
  }

  /** API-33 : `item.created`, `item.updated`, `item.removed` au salon de la liste. */
  async itemChanged(event: ItemChanged): Promise<void> {
    const type = `item.${event.change}`;
    const data = { listId: event.listId, itemId: event.itemId };
    await this.deliver(`list:${event.listId}`, { type, data }, async (profileIds) => {
      // Un élément supprimé n'a plus de faits : seul l'auteur du geste en est averti (il l'a vu).
      if (event.change === 'removed') {
        return new Set(profileIds.filter((id) => id === event.actorId));
      }
      const contexts = await this.items.forViewers(profileIds, event.itemId);
      return new Set(
        [...contexts].flatMap(([id, context]) =>
          event.audience === 'givers' && context.view !== 'giver' ? [] : [id],
        ),
      );
    });
    if (event.accessChanged) await this.recheckAll();
  }

  /** `list.updated` : jamais à l'aperçu d'une giftlist révélée (GFT-09, NOT-05). */
  async listChanged(event: ListChanged): Promise<void> {
    await this.deliver(
      `list:${event.listId}`,
      { type: 'list.updated', data: { listId: event.listId } },
      async (profileIds) => {
        const out = new Set<string>();
        for (const id of profileIds) {
          const kind = await this.items.listAccess(id, event.listId);
          if (kind === 'giver' || kind === 'recipient') out.add(id);
        }
        return out;
      },
    );
    if (event.accessChanged) await this.recheckAll();
  }

  /** `comment.*` au salon du fil, à qui lit ce fil (COM-11). */
  async commentChanged(event: CommentChanged): Promise<void> {
    const room = roomName({ kind: 'item', id: event.itemId, thread: event.thread });
    await this.deliver(
      room,
      {
        type: `comment.${event.change}`,
        data: { itemId: event.itemId, thread: event.thread, commentId: event.commentId },
      },
      async (profileIds) => {
        const contexts = await this.items.forViewers(profileIds, event.itemId);
        return new Set(
          [...contexts].flatMap(([id, context]) =>
            threadLevel(context.threads, event.thread) === 'none' ? [] : [id],
          ),
        );
      },
    );
  }

  /**
   * `accounting.changed` (API-33, CPT-59) : salon des offreurs de l'élément, à qui le voit sous la
   * forme offreur seulement ; jamais à un destinataire. Un élément disparu n'a plus de salon.
   */
  async accountingChanged(event: AccountingChanged): Promise<void> {
    const itemId = event.itemId;
    if (itemId === null) return;
    await this.deliver(
      roomName({ kind: 'item', id: itemId, thread: 'GIVERS' }),
      { type: 'accounting.changed', data: { itemId } },
      async (profileIds) => {
        const contexts = await this.items.forViewers(profileIds, itemId);
        return new Set(
          [...contexts].flatMap(([id, context]) => (context.view === 'giver' ? [id] : [])),
        );
      },
    );
  }

  /** `event.updated` à qui voit l'événement (VIS-36). */
  async eventChanged(event: EventChanged): Promise<void> {
    await this.deliver(
      `event:${event.eventId}`,
      { type: 'event.updated', data: { eventId: event.eventId } },
      (profileIds) => this.events.viewers(event.eventId, profileIds),
    );
    if (event.accessChanged) await this.recheckAll();
  }

  /** `notification.created` au seul profil concerné, avec son numéro (RT-12). */
  async notificationCreated(event: NotificationCreated): Promise<void> {
    await this.deliver(
      `profile:${event.profileId}`,
      {
        type: 'notification.created',
        data: { notificationId: event.notificationId, seq: event.seq },
        seq: event.seq,
      },
      (profileIds) => Promise.resolve(new Set(profileIds.filter((id) => id === event.profileId))),
    );
  }

  /** `product.extracted` à l'auteur de la fiche. */
  async productExtracted(event: ProductExtracted): Promise<void> {
    await this.deliver(
      `profile:${event.ownerId}`,
      { type: 'product.extracted', data: { productId: event.productId } },
      (profileIds) => Promise.resolve(new Set(profileIds.filter((id) => id === event.ownerId))),
    );
  }

  /**
   * RT-05, RT-11 : présence et saisie, dans le salon d'offreurs où l'émetteur est abonné, s'il
   * partage sa présence ; reçues par qui lit le fil Offreurs (jamais un destinataire).
   */
  async presence(
    from: SocketHandle,
    input: { itemId: string; kind: 'presence' | 'typing'; present: boolean },
  ): Promise<void> {
    const room = roomName({ kind: 'item', id: input.itemId, thread: 'GIVERS' });
    if (!from.rooms.has(room) || !(await this.alive(from))) return;
    if (
      !(await this.canJoin(from.profileId, { kind: 'item', id: input.itemId, thread: 'GIVERS' }))
    ) {
      return;
    }
    if (!(await this.preferences.settings(from.profileId)).sharePresence) return;
    const type = input.kind === 'typing' ? 'typing' : 'presence.changed';
    await this.deliver(
      room,
      { type, data: { itemId: input.itemId, profileId: from.profileId, present: input.present } },
      async (profileIds) => {
        const contexts = await this.items.forViewers(profileIds, input.itemId);
        return new Set(
          [...contexts].flatMap(([id, context]) =>
            id === from.profileId || context.threads.givers === 'none' ? [] : [id],
          ),
        );
      },
    );
  }

  /**
   * RT-10 (revue SEC-40, I1) : revérifications regroupées ; une seule en cours, au plus une autre
   * en attente qui couvre toutes les demandes arrivées entre-temps. `profileIds` restreint aux
   * sockets de ces profils (changement de cercle) ; absent, toutes les sockets.
   */
  private running: Promise<void> | null = null;
  private queued: { all: boolean; profiles: Set<string> } | null = null;

  recheckAll(profileIds?: readonly string[]): Promise<void> {
    const next = this.queued ?? { all: false, profiles: new Set<string>() };
    if (profileIds) for (const id of profileIds) next.profiles.add(id);
    else next.all = true;
    this.queued = next;
    if (!this.running) {
      this.running = (async () => {
        while (this.queued) {
          const scope = this.queued;
          this.queued = null;
          await this.recheck(scope.all ? null : scope.profiles);
        }
      })().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  /**
   * RT-07, RT-10 : chaque socket quitte les salons qu'elle ne peut plus lire et en reçoit l'avis
   * (`access.revoked`) ; une session morte est fermée.
   */
  private async recheck(profiles: ReadonlySet<string> | null): Promise<void> {
    for (const socket of await this.sockets.allSockets()) {
      if (profiles && !profiles.has(socket.profileId)) continue;
      if (!(await this.alive(socket))) continue;
      for (const name of socket.rooms) {
        const room = parseRoom(name);
        if (!room || (await this.canJoin(socket.profileId, room))) continue;
        socket.leave(name);
        socket.send({
          type: 'access.revoked',
          room: `profile:${socket.profileId}`,
          data: { room: name },
        });
      }
    }
  }

  /** ADR 0013 : révocation, verrouillage, changement de profil ferment les sockets de la session. */
  async closeSession(sessionId: string): Promise<void> {
    for (const socket of await this.sockets.allSockets()) {
      if (socket.sessionId === sessionId) socket.disconnect();
    }
  }
}
