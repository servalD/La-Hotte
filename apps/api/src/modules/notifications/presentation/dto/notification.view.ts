import { ApiProperty } from '@nestjs/swagger';
import {
  DIGEST_FREQUENCIES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
} from '../../application/contract';
import { NOTIFICATION_TYPE_VALUES } from './notification.dto';

/** NOT-11 : titres relus par le moteur à chaque lecture. */
export class NotificationView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() seq!: number;
  @ApiProperty({ enum: NOTIFICATION_TYPE_VALUES, enumName: 'NotificationType' })
  type!: (typeof NOTIFICATION_TYPE_VALUES)[number];
  @ApiProperty({ enum: NOTIFICATION_CATEGORIES, enumName: 'NotificationCategory' })
  category!: (typeof NOTIFICATION_CATEGORIES)[number];
  @ApiProperty({ type: String, nullable: true }) title!: string | null;
  @ApiProperty({ type: String, nullable: true }) context!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) itemId!: string | null;
  @ApiProperty({ enum: ['PUBLIC', 'GIVERS'], enumName: 'CommentThread', nullable: true })
  thread!: 'PUBLIC' | 'GIVERS' | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) listId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) eventId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) commentId!: string | null;
  @ApiProperty({ type: String, nullable: true }) actorName!: string | null;
  @ApiProperty() read!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class NotificationPageView {
  @ApiProperty({ type: [NotificationView] }) items!: NotificationView[];
  @ApiProperty({ type: Number, nullable: true }) nextBeforeSeq!: number | null;
}

/** VIS-22 : 99 au plus. */
export class UnreadCountView {
  @ApiProperty({ minimum: 0, maximum: 99 }) count!: number;
}

/** RT-12 */
export class SyncView {
  @ApiProperty({ type: [NotificationView] }) notifications!: NotificationView[];
  @ApiProperty() lastSeq!: number;
  @ApiProperty() reset!: boolean;
}

export class ChannelStateView {
  @ApiProperty({ enum: NOTIFICATION_CATEGORIES, enumName: 'NotificationCategory' })
  category!: (typeof NOTIFICATION_CATEGORIES)[number];
  @ApiProperty({ enum: NOTIFICATION_CHANNELS, enumName: 'NotificationChannel' })
  channel!: (typeof NOTIFICATION_CHANNELS)[number];
  @ApiProperty() enabled!: boolean;
  /** NOT-04 : la sécurité ne se désactive pas. */
  @ApiProperty() locked!: boolean;
}

export class NotificationPreferencesView {
  @ApiProperty({ type: [ChannelStateView] }) channels!: ChannelStateView[];
  @ApiProperty() quietEnabled!: boolean;
  @ApiProperty() quietStart!: number;
  @ApiProperty() quietEnd!: number;
  @ApiProperty({ enum: DIGEST_FREQUENCIES, enumName: 'DigestFrequency' })
  digest!: (typeof DIGEST_FREQUENCIES)[number];
  @ApiProperty() sharePresence!: boolean;
}
