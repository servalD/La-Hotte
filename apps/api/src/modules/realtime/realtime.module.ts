import { Module } from '@nestjs/common';
import { EventsModule } from '../events';
import { IdentityModule } from '../identity';
import { ListsModule } from '../lists';
import { NotificationsModule } from '../notifications';
import { RealtimeDispatcher } from './application/realtime-dispatcher';
import { SocketDirectory } from './domain/rooms';
import { RealtimeGateway } from './presentation/realtime.gateway';
import { RealtimeSubscriber } from './presentation/realtime.subscriber';
import { SocketRegistry } from './infrastructure/socket-registry';

/** Module `realtime` : passerelle, salons, revérification (06, 13, ADR 0006, ADR 0018). */
@Module({
  imports: [IdentityModule, ListsModule, EventsModule, NotificationsModule],
  providers: [
    SocketRegistry,
    { provide: SocketDirectory, useExisting: SocketRegistry },
    RealtimeGateway,
    RealtimeDispatcher,
    RealtimeSubscriber,
  ],
})
export class RealtimeModule {}
