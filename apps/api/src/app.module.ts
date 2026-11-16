import { Module } from '@nestjs/common';
import { CatalogModule } from './modules/catalog';
import { ConversationsModule } from './modules/conversations';
import { DirectoryModule } from './modules/directory';
import { EventsModule } from './modules/events';
import { IdentityModule } from './modules/identity';
import { ListsModule } from './modules/lists';
import { NotificationsModule } from './modules/notifications';
import { RealtimeModule } from './modules/realtime';
import { VisibilityModule } from './modules/visibility';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [
    PlatformModule,
    IdentityModule,
    VisibilityModule,
    CatalogModule,
    ListsModule,
    DirectoryModule,
    EventsModule,
    ConversationsModule,
    NotificationsModule,
    RealtimeModule,
  ],
})
export class AppModule {}
