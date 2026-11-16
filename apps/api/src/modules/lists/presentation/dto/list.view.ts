import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import {
  GIFT_CONTENTS,
  GIFT_EXISTENCES,
  ITEM_PRIORITIES,
  LIST_TYPES,
  VISIBILITY_EDIT_ROLES,
  VISIBILITY_MODES,
} from './list.dto';

// Vues de réponse (API-12, VIS-35) : la vue destinataire et la vue offreur sont des schémas
// distincts ; un champ d'offreur n'existe pas dans une vue destinataire, ni même à `null`. Toute vue
// `*RecipientView` est déclarée champ par champ dans `test/contract/recipient-view-guard.ts`.

const ROLES = ['CREATOR', 'OWNER', 'CONTRIBUTOR', 'READER'] as const;
const AUDIENCES = ['MEMBERS', 'CIRCLE', 'EVENT', 'CUSTOM'] as const;
const ADD_RIGHTS = ['none', 'suggestion', 'item', 'item_or_suggestion'] as const;
const GIVER_STATUSES = ['OPEN', 'RESERVED', 'PURCHASED', 'RECEIVED'] as const;

/** Ce que le profil actif peut faire (l'interface s'y règle ; le serveur revérifie tout). */
export class ListPermissionsView {
  @ApiProperty() edit!: boolean;
  @ApiProperty() archive!: boolean;
  @ApiProperty() delete!: boolean;
  @ApiProperty() restore!: boolean;
  @ApiProperty() manageMembers!: boolean;
  @ApiProperty({ enum: ADD_RIGHTS, enumName: 'AddRight' }) add!: (typeof ADD_RIGHTS)[number];
  @ApiProperty() editRules!: boolean;
  @ApiProperty() readLog!: boolean;
}

/** Liste vue par un offreur (membre ou audience). */
export class ListGiverView {
  @ApiProperty({ enum: ['giver'] }) view!: 'giver';
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: LIST_TYPES, enumName: 'ListType' }) type!: (typeof LIST_TYPES)[number];
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty() personal!: boolean;
  /** EVT-29 : événement de rattachement. */
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) eventId!: string | null;
  @ApiProperty({ type: [String], format: 'uuid' }) recipients!: string[];
  @ApiProperty({ enum: ROLES, enumName: 'ListRole', nullable: true })
  myRole!: (typeof ROLES)[number] | null;
  @ApiProperty({ enum: AUDIENCES, enumName: 'ListAudience' }) audience!: (typeof AUDIENCES)[number];
  @ApiProperty({ type: [String], format: 'uuid' }) customAudience!: string[];
  @ApiProperty({ enum: VISIBILITY_MODES, enumName: 'VisibilityMode' })
  defaultItemVisibility!: (typeof VISIBILITY_MODES)[number];
  @ApiProperty({ enum: VISIBILITY_EDIT_ROLES, enumName: 'VisibilityEditRole' })
  visibilityEditRole!: (typeof VISIBILITY_EDIT_ROLES)[number];
  @ApiProperty({ enum: GIFT_EXISTENCES, enumName: 'GiftExistence' })
  giftExistence!: (typeof GIFT_EXISTENCES)[number];
  @ApiProperty({ enum: GIFT_CONTENTS, enumName: 'GiftContent' })
  giftContent!: (typeof GIFT_CONTENTS)[number];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) deletedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: ListPermissionsView }) permissions!: ListPermissionsView;
}

/** Wishlist vue par l'un de ses destinataires (VIS-20, LST-16). */
export class ListRecipientView {
  @ApiProperty({ enum: ['recipient'] }) view!: 'recipient';
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty() personal!: boolean;
  /** EVT-29 : sa propre wishlist ; jamais sur l'aperçu d'une giftlist (GFT-09). */
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) eventId!: string | null;
  @ApiProperty({ type: [String], format: 'uuid' }) recipients!: string[];
  @ApiProperty({ enum: ROLES, enumName: 'ListRole', nullable: true })
  myRole!: (typeof ROLES)[number] | null;
  @ApiProperty({ enum: AUDIENCES, enumName: 'ListAudience' }) audience!: (typeof AUDIENCES)[number];
  @ApiProperty({ type: [String], format: 'uuid' }) customAudience!: string[];
  @ApiProperty({ enum: VISIBILITY_MODES, enumName: 'VisibilityMode' })
  defaultItemVisibility!: (typeof VISIBILITY_MODES)[number];
  @ApiProperty({ enum: VISIBILITY_EDIT_ROLES, enumName: 'VisibilityEditRole' })
  visibilityEditRole!: (typeof VISIBILITY_EDIT_ROLES)[number];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) deletedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: ListPermissionsView }) permissions!: ListPermissionsView;
}

/**
 * GFT-03, GFT-09 : la giftlist révélée vue par son destinataire. L'existence seule : ni titre, ni
 * description, ni créateur, ni membres. `content` dit si des éléments sont montrés.
 */
export class ListTeaserRecipientView {
  @ApiProperty({ enum: ['teaser'] }) view!: 'teaser';
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: GIFT_CONTENTS, enumName: 'GiftContent' })
  content!: (typeof GIFT_CONTENTS)[number];
}

export const LIST_VIEW_SCHEMA = {
  oneOf: [
    { $ref: getSchemaPath(ListGiverView) },
    { $ref: getSchemaPath(ListRecipientView) },
    { $ref: getSchemaPath(ListTeaserRecipientView) },
  ],
  discriminator: {
    propertyName: 'view',
    mapping: {
      giver: getSchemaPath(ListGiverView),
      recipient: getSchemaPath(ListRecipientView),
      teaser: getSchemaPath(ListTeaserRecipientView),
    },
  },
};

export type ListView = ListGiverView | ListRecipientView | ListTeaserRecipientView;

export class ListCollectionView {
  @ApiProperty({ type: 'array', items: LIST_VIEW_SCHEMA })
  items!: ListView[];
}

export class ListMemberView {
  @ApiProperty({ format: 'uuid' }) profileId!: string;
  @ApiProperty({ enum: ROLES, enumName: 'ListRole' }) role!: (typeof ROLES)[number];
  @ApiProperty({ format: 'date-time' }) since!: string;
}

export class ListMemberCollectionView {
  @ApiProperty({ type: [ListMemberView] }) items!: ListMemberView[];
}

/** Fiche telle qu'un élément la montre (ART-01). */
export class ItemProductView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: String, nullable: true }) imageKey!: string | null;
  @ApiProperty({ type: String, nullable: true }) merchant!: string | null;
  @ApiProperty({ type: String, nullable: true }) sourceUrl!: string | null;
}

/** VIS-35 : liste fermée de champs. */
export class ItemRecipientView {
  @ApiProperty({ enum: ['recipient'] }) view!: 'recipient';
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) listId!: string;
  @ApiProperty({ type: ItemProductView }) product!: ItemProductView;
  @ApiProperty() quantity!: number;
  @ApiProperty({ type: Number, nullable: true }) unitPriceMinor!: number | null;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: ITEM_PRIORITIES, enumName: 'ItemPriority' })
  priority!: (typeof ITEM_PRIORITIES)[number];
  @ApiProperty() note!: string;
  @ApiProperty() manyWelcome!: boolean;
  @ApiProperty() hidden!: boolean;
  @ApiProperty() received!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) receivedAt!: string | null;
  @ApiProperty() mine!: boolean;
  /** EVT-27 : reporté vers une autre liste, son propre geste. */
  @ApiProperty() carriedForward!: boolean;
  @ApiProperty() version!: number;
}

/** EVT-28 : état réel de l'origine d'une reprise, en vue offreur seulement. */
export class CarriedFromEventView {
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'date' }) date!: string;
}

export class CarriedFromView {
  @ApiProperty({ enum: ['RESERVED', 'PURCHASED'], enumName: 'CarriedFromStatus' })
  status!: 'RESERVED' | 'PURCHASED';
  @ApiProperty({ type: CarriedFromEventView, nullable: true }) event!: CarriedFromEventView | null;
}

export class ItemGiverView {
  @ApiProperty({ enum: ['giver'] }) view!: 'giver';
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) listId!: string;
  @ApiProperty({ type: ItemProductView }) product!: ItemProductView;
  @ApiProperty() quantity!: number;
  @ApiProperty({ type: Number, nullable: true }) unitPriceMinor!: number | null;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: ITEM_PRIORITIES, enumName: 'ItemPriority' })
  priority!: (typeof ITEM_PRIORITIES)[number];
  @ApiProperty() note!: string;
  @ApiProperty() manyWelcome!: boolean;
  @ApiProperty() position!: number;
  @ApiProperty() hidden!: boolean;
  @ApiProperty({ enum: VISIBILITY_MODES, enumName: 'VisibilityMode' })
  visibilityMode!: (typeof VISIBILITY_MODES)[number];
  @ApiProperty({ enum: GIVER_STATUSES, enumName: 'GiverItemStatus' })
  status!: (typeof GIVER_STATUSES)[number];
  @ApiProperty() isSuggestion!: boolean;
  @ApiProperty() shownToRecipient!: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) intendedRecipientId!:
    string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) addedBy!: string | null;
  @ApiProperty() mine!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty() carriedForward!: boolean;
  @ApiProperty({ type: CarriedFromView, nullable: true }) carriedFrom!: CarriedFromView | null;
  @ApiProperty() version!: number;
}

export const ITEM_VIEW_SCHEMA = {
  oneOf: [{ $ref: getSchemaPath(ItemGiverView) }, { $ref: getSchemaPath(ItemRecipientView) }],
  discriminator: {
    propertyName: 'view',
    mapping: {
      giver: getSchemaPath(ItemGiverView),
      recipient: getSchemaPath(ItemRecipientView),
    },
  },
};

export type ItemViewDto = ItemGiverView | ItemRecipientView;

export class ItemCollectionView {
  @ApiProperty({ type: 'array', items: ITEM_VIEW_SCHEMA })
  items!: ItemViewDto[];
}

export class CopiedProductView {
  @ApiProperty({ format: 'uuid' }) productId!: string;
}

/** VIS-10, VIS-12 : la règle d'un élément, lue par qui peut la modifier (VIS-19). */
export class ItemRuleView {
  @ApiProperty({ enum: VISIBILITY_MODES, enumName: 'VisibilityMode' })
  mode!: (typeof VISIBILITY_MODES)[number];
  @ApiProperty({ type: [String], format: 'uuid' }) profiles!: string[];
  /** VIS-12 : profils choisis hors de l'audience de la liste ; l'interface propose de les y ajouter. */
  @ApiProperty({ type: [String], format: 'uuid' }) outsideAudience!: string[];
  /** Version de l'élément, pour `If-Match`. */
  @ApiProperty() version!: number;
}

export class RuleSnapshotView {
  @ApiProperty({ enum: VISIBILITY_MODES, enumName: 'VisibilityMode' })
  mode!: (typeof VISIBILITY_MODES)[number];
  @ApiProperty({ type: [String], format: 'uuid' }) profiles!: string[];
}

/** VIS-14 : qui, quand, avant, après. */
export class VisibilityLogEntryView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  /** Absent : règle par défaut de la liste. */
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) itemId!: string | null;
  @ApiProperty({ format: 'uuid' }) changedBy!: string;
  @ApiProperty({ type: RuleSnapshotView }) before!: RuleSnapshotView;
  @ApiProperty({ type: RuleSnapshotView }) after!: RuleSnapshotView;
  @ApiProperty({ format: 'date-time' }) at!: string;
}

export class VisibilityLogView {
  @ApiProperty({ type: [VisibilityLogEntryView] }) items!: VisibilityLogEntryView[];
}
