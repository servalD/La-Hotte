import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { REACTIONS, THREADS } from './comment.dto';

const ACTIVITY_CODES = ['PRICE_CHANGED', 'RECEIVED', 'UNRECEIVED', 'SHOWN'] as const;

export class CommentPersonView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true }) avatar!: string | null;
  @ApiProperty() accentColor!: string;
}

/** COM-14 : code et valeurs, sans texte libre. */
export class CommentActivityView {
  @ApiProperty({ enum: ACTIVITY_CODES, enumName: 'CommentActivityCode' })
  code!: (typeof ACTIVITY_CODES)[number];
  @ApiProperty({ type: Number, nullable: true }) beforeMinor!: number | null;
  @ApiProperty({ type: Number, nullable: true }) afterMinor!: number | null;
  @ApiProperty({ type: String, nullable: true }) currency!: string | null;
}

export class CommentReactionView {
  @ApiProperty({ enum: REACTIONS, enumName: 'CommentReaction' })
  reaction!: (typeof REACTIONS)[number];
  @ApiProperty() count!: number;
  @ApiProperty() mine!: boolean;
}

/** Message ou activité d'un fil que le lecteur lit (COM-11). */
export class CommentView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty({ enum: THREADS, enumName: 'CommentThread' }) thread!: (typeof THREADS)[number];
  @ApiProperty({ enum: ['MESSAGE', 'ACTIVITY'], enumName: 'CommentKind' })
  kind!: 'MESSAGE' | 'ACTIVITY';
  @ApiProperty({ type: CommentPersonView, nullable: true }) author!: CommentPersonView | null;
  /** COM-09, COM-13 : texte brut, rendu échappé par le client. */
  @ApiProperty() body!: string;
  @ApiProperty({ type: [CommentPersonView] }) mentions!: CommentPersonView[];
  @ApiProperty({ type: CommentActivityView, nullable: true })
  activity!: CommentActivityView | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) editedAt!: string | null;
  @ApiProperty() deleted!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: [CommentReactionView] }) reactions!: CommentReactionView[];
  @ApiProperty() mine!: boolean;
  @ApiProperty() canEdit!: boolean;
  @ApiProperty() canDelete!: boolean;
}

export class CommentPageView {
  @ApiProperty({ type: [CommentView] }) items!: CommentView[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

/** Un fil : nombre de messages et droit d'écrire (COM-11, COM-17). */
export class ThreadCountView {
  @ApiProperty() count!: number;
  @ApiProperty() canWrite!: boolean;
}

/** COM-03 : un destinataire n'a que le fil Public, ni onglet ni compteur de l'autre. */
export class ItemThreadsRecipientView {
  @ApiProperty({ enum: ['recipient'] }) view!: 'recipient';
  @ApiProperty({ type: ThreadCountView }) public!: ThreadCountView;
  @ApiProperty() following!: boolean;
}

/** COM-12 : `public` absent (`null`) quand le fil Public est fermé. */
export class ItemThreadsGiverView {
  @ApiProperty({ enum: ['giver'] }) view!: 'giver';
  @ApiProperty({ type: ThreadCountView, nullable: true }) public!: ThreadCountView | null;
  @ApiProperty({ type: ThreadCountView }) givers!: ThreadCountView;
  @ApiProperty() following!: boolean;
}

export const THREADS_VIEW_SCHEMA = {
  oneOf: [
    { $ref: getSchemaPath(ItemThreadsGiverView) },
    { $ref: getSchemaPath(ItemThreadsRecipientView) },
  ],
  discriminator: {
    propertyName: 'view',
    mapping: {
      giver: getSchemaPath(ItemThreadsGiverView),
      recipient: getSchemaPath(ItemThreadsRecipientView),
    },
  },
};

export type ThreadsViewDto = ItemThreadsGiverView | ItemThreadsRecipientView;
