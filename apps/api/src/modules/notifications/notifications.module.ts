import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { ConversationsModule } from '../conversations';
import { EventsModule } from '../events';
import { IdentityModule } from '../identity';
import { ListsModule } from '../lists';
import { ProduceNotifications } from './application/produce-notifications.use-case';
import { PurgeNotifications } from './application/purge-notifications.use-case';
import {
  CountUnreadNotifications,
  GetNotificationPreferences,
  ListNotifications,
  MarkNotificationsRead,
  NotificationViews,
  SyncNotifications,
  UpdateNotificationPreferences,
} from './application/read-notifications.use-case';
import {
  DeliverPushes,
  ManagePushSubscriptions,
  SendDigests,
} from './application/push-and-digest.use-case';
import { RouteNotices } from './application/route-notices.use-case';
import {
  DeliveryGateway,
  DigestRepository,
  NotificationPeople,
  NotificationRepository,
  NotificationSubjects,
  PreferenceRepository,
  PushSender,
  PushSubscriptionRepository,
} from './domain/notification.ports';
import {
  IdentityDeliveryGateway,
  PrismaDigestRepository,
  PrismaPushSubscriptionRepository,
  WebPushSender,
} from './infrastructure/prisma-push';
import { DeliveryScheduler } from './presentation/delivery.scheduler';
import { PushController } from './presentation/push.controller';
import { EngineNotificationSubjects } from './infrastructure/engine-subjects';
import {
  PrismaNotificationPeople,
  PrismaNotificationRepository,
  PrismaPreferenceRepository,
} from './infrastructure/prisma-notifications';
import { NoticeSubscriber, NotificationPurgeScheduler } from './presentation/notice.subscriber';
import { NotificationsController } from './presentation/notifications.controller';

/** Module `notifications` : production par candidat, centre, préférences (06, ADR 0018). */
@Module({
  imports: [IdentityModule, ListsModule, EventsModule, CatalogModule, ConversationsModule],
  controllers: [NotificationsController, PushController],
  providers: [
    ProduceNotifications,
    RouteNotices,
    NotificationViews,
    ListNotifications,
    CountUnreadNotifications,
    MarkNotificationsRead,
    SyncNotifications,
    GetNotificationPreferences,
    UpdateNotificationPreferences,
    PurgeNotifications,
    NoticeSubscriber,
    NotificationPurgeScheduler,
    ManagePushSubscriptions,
    DeliverPushes,
    SendDigests,
    DeliveryScheduler,
    { provide: PushSubscriptionRepository, useClass: PrismaPushSubscriptionRepository },
    { provide: PushSender, useClass: WebPushSender },
    { provide: DeliveryGateway, useClass: IdentityDeliveryGateway },
    { provide: DigestRepository, useClass: PrismaDigestRepository },
    { provide: NotificationRepository, useClass: PrismaNotificationRepository },
    { provide: PreferenceRepository, useClass: PrismaPreferenceRepository },
    { provide: NotificationPeople, useClass: PrismaNotificationPeople },
    { provide: NotificationSubjects, useClass: EngineNotificationSubjects },
  ],
  exports: [NotificationRepository, PreferenceRepository, NotificationSubjects, NotificationPeople],
})
export class NotificationsModule {}
