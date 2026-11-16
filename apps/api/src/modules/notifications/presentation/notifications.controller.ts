import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ActiveProfile, type ActiveProfileValue, RequiresProfile } from '../../identity';
import {
  CountUnreadNotifications,
  GetNotificationPreferences,
  ListNotifications,
  MarkNotificationsRead,
  type NotificationView as NotificationModel,
  type PreferencesState,
  SyncNotifications,
  UpdateNotificationPreferences,
} from '../application/contract';
import {
  MarkReadDto,
  NotificationsQueryDto,
  SyncQueryDto,
  UpdatePreferencesDto,
} from './dto/notification.dto';
import {
  NotificationPageView,
  NotificationPreferencesView,
  NotificationView,
  SyncView,
  UnreadCountView,
} from './dto/notification.view';

function toView(n: NotificationModel): NotificationView {
  return {
    id: n.id,
    seq: n.seq,
    type: n.type,
    category: n.category,
    title: n.title,
    context: n.context,
    itemId: n.itemId,
    thread: n.thread,
    listId: n.listId,
    eventId: n.eventId,
    commentId: n.commentId,
    actorName: n.actorName,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
  };
}

function toPreferences(state: PreferencesState): NotificationPreferencesView {
  return {
    channels: state.channels.map((c) => ({
      category: c.category,
      channel: c.channel,
      enabled: c.enabled,
      locked: c.locked,
    })),
    quietEnabled: state.settings.quietEnabled,
    quietStart: state.settings.quietStart,
    quietEnd: state.settings.quietEnd,
    digest: state.settings.digest,
    sharePresence: state.settings.sharePresence,
  };
}

/**
 * Centre de notifications du profil actif (NOT-01, NOT-11, NOT-18) et rattrapage (RT-12). Chaque
 * notification est revérifiée par le moteur à la lecture.
 */
@ApiTags('notifications')
@RequiresProfile()
@Controller()
export class NotificationsController {
  constructor(
    private readonly list: ListNotifications,
    private readonly count: CountUnreadNotifications,
    private readonly markRead: MarkNotificationsRead,
    private readonly sync: SyncNotifications,
    private readonly getPrefs: GetNotificationPreferences,
    private readonly updatePrefs: UpdateNotificationPreferences,
  ) {}

  @Get('notifications')
  @ApiOkResponse({ type: NotificationPageView })
  async listNotifications(
    @Query() query: NotificationsQueryDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<NotificationPageView> {
    const page = await this.list.execute({
      viewerId: profile.id,
      ...(query.beforeSeq ? { beforeSeq: query.beforeSeq } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
    });
    return { items: page.items.map(toView), nextBeforeSeq: page.nextBeforeSeq };
  }

  /** VIS-22 */
  @Get('notifications/unread-count')
  @ApiOkResponse({ type: UnreadCountView })
  async countUnreadNotifications(
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<UnreadCountView> {
    return { count: await this.count.execute({ viewerId: profile.id }) };
  }

  /** NOT-18 */
  @Post('notifications/read')
  @HttpCode(204)
  @ApiNoContentResponse()
  async markNotificationsRead(
    @Body() body: MarkReadDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.markRead.execute({
      viewerId: profile.id,
      ...(body.ids ? { ids: body.ids } : {}),
      ...(body.upToSeq !== undefined ? { upToSeq: body.upToSeq } : {}),
    });
  }

  /** RT-12 */
  @Get('sync')
  @ApiOkResponse({ type: SyncView })
  async syncSince(
    @Query() query: SyncQueryDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<SyncView> {
    const result = await this.sync.execute({ viewerId: profile.id, since: query.since });
    return {
      notifications: result.items.map(toView),
      lastSeq: result.lastSeq,
      reset: result.reset,
    };
  }

  @Get('notification-preferences')
  @ApiOkResponse({ type: NotificationPreferencesView })
  async getNotificationPreferences(
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<NotificationPreferencesView> {
    return toPreferences(await this.getPrefs.execute({ viewerId: profile.id }));
  }

  /** NOT-04, NOT-14, NOT-17, RT-11 */
  @Put('notification-preferences')
  @ApiOkResponse({ type: NotificationPreferencesView })
  async updateNotificationPreferences(
    @Body() body: UpdatePreferencesDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<NotificationPreferencesView> {
    return toPreferences(
      await this.updatePrefs.execute({
        viewerId: profile.id,
        channels: body.channels,
        quietEnabled: body.quietEnabled,
        quietStart: body.quietStart,
        quietEnd: body.quietEnd,
        digest: body.digest,
        sharePresence: body.sharePresence,
      }),
    );
  }
}
