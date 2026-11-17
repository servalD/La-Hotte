import { ApiProperty, getSchemaPath } from '@nestjs/swagger';

const MODES = ['FULL', 'PERCENT', 'FIXED'] as const;
const SETTLEMENTS = ['NONE', 'DUE', 'CLAIMED', 'SETTLED'] as const;
const REVIEW_KINDS = ['COST', 'OPTIONS'] as const;

export class AccountingPersonView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true }) avatar!: string | null;
  @ApiProperty() accentColor!: string;
}

export class ContributionShareView {
  @ApiProperty() num!: number;
  @ApiProperty() den!: number;
}

/** CPT-59 : ce qu'un offreur lit d'une participation, sans montant. */
export class GiverContributionLineView {
  @ApiProperty({ type: AccountingPersonView, nullable: true }) person!: AccountingPersonView | null;
  @ApiProperty({ enum: MODES, enumName: 'ContributionMode' }) mode!: (typeof MODES)[number];
  @ApiProperty() rank!: number;
  @ApiProperty() isBuyer!: boolean;
}

/** CPT-59 : ce qu'un participant lit d'une participation. */
export class ParticipantContributionLineView {
  @ApiProperty({ type: AccountingPersonView, nullable: true }) person!: AccountingPersonView | null;
  @ApiProperty({ enum: MODES, enumName: 'ContributionMode' }) mode!: (typeof MODES)[number];
  @ApiProperty() rank!: number;
  @ApiProperty() isBuyer!: boolean;
  @ApiProperty({ type: Number, nullable: true }) amountMinor!: number | null;
  @ApiProperty({ type: Number, nullable: true }) units!: number | null;
  @ApiProperty() mine!: boolean;
}

/** Ma participation et son règlement (CPT-20 à CPT-22, CPT-65). */
export class MyContributionView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: MODES, enumName: 'ContributionMode' }) mode!: (typeof MODES)[number];
  @ApiProperty({ type: ContributionShareView, nullable: true })
  share!: ContributionShareView | null;
  @ApiProperty({ type: Number, nullable: true }) units!: number | null;
  @ApiProperty({ type: Number, nullable: true }) amountMinor!: number | null;
  @ApiProperty() rank!: number;
  @ApiProperty({ enum: SETTLEMENTS, enumName: 'SettlementState' })
  settlement!: (typeof SETTLEMENTS)[number];
  @ApiProperty() settledMinor!: number;
}

/** CPT-58 : demande de revue en attente. */
export class AccountingReviewView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: REVIEW_KINDS, enumName: 'AccountingReviewKind' })
  kind!: (typeof REVIEW_KINDS)[number];
  @ApiProperty({ type: AccountingPersonView, nullable: true }) author!: AccountingPersonView | null;
  @ApiProperty({ type: Number, nullable: true }) proposedTotalMinor!: number | null;
  @ApiProperty({ type: Boolean, nullable: true }) proposedReviewEnabled!: boolean | null;
  @ApiProperty({ type: Boolean, nullable: true }) proposedReceiptEnabled!: boolean | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty() canDecide!: boolean;
}

/** CPT-61 : demande de changement d'acheteur en attente. */
export class BuyerRequestView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: AccountingPersonView, nullable: true })
  candidate!: AccountingPersonView | null;
  @ApiProperty() mine!: boolean;
  @ApiProperty() canDecide!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

class AccountingCommonFields {
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) accountingId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) itemId!: string | null;
  @ApiProperty() title!: string;
  @ApiProperty({ minLength: 3, maxLength: 3 }) currency!: string;
  @ApiProperty({ type: Number, nullable: true }) plannedTotalMinor!: number | null;
  @ApiProperty({ type: Number, nullable: true }) itemTotalMinor!: number | null;
  @ApiProperty() coveredMinor!: number;
  @ApiProperty({ type: Number, nullable: true }) remainingMinor!: number | null;
  @ApiProperty({ type: AccountingPersonView, nullable: true }) buyer!: AccountingPersonView | null;
  @ApiProperty() purchased!: boolean;
  @ApiProperty() canContribute!: boolean;
}

/** CPT-59 : vue d'un offreur qui ne participe pas. */
export class ItemAccountingGiverView extends AccountingCommonFields {
  @ApiProperty({ enum: ['giver'] }) view!: 'giver';
  @ApiProperty({ type: [GiverContributionLineView] }) participants!: GiverContributionLineView[];
}

/** CPT-59 : vue d'un participant (montants, options, demandes). */
export class ItemAccountingParticipantView extends AccountingCommonFields {
  @ApiProperty({ enum: ['participant'] }) view!: 'participant';
  @ApiProperty({ type: [ParticipantContributionLineView] })
  participants!: ParticipantContributionLineView[];
  @ApiProperty({ type: MyContributionView, nullable: true }) mine!: MyContributionView | null;
  @ApiProperty() isBuyer!: boolean;
  @ApiProperty() reviewEnabled!: boolean;
  @ApiProperty() receiptEnabled!: boolean;
  @ApiProperty({ type: [AccountingReviewView] }) reviews!: AccountingReviewView[];
  @ApiProperty({ type: BuyerRequestView, nullable: true }) buyerRequest!: BuyerRequestView | null;
  @ApiProperty() hasReceipt!: boolean;
}

export const ACCOUNTING_VIEW_SCHEMA = {
  oneOf: [
    { $ref: getSchemaPath(ItemAccountingGiverView) },
    { $ref: getSchemaPath(ItemAccountingParticipantView) },
  ],
  discriminator: {
    propertyName: 'view',
    mapping: {
      giver: getSchemaPath(ItemAccountingGiverView),
      participant: getSchemaPath(ItemAccountingParticipantView),
    },
  },
};

export type ItemAccountingViewDto = ItemAccountingGiverView | ItemAccountingParticipantView;
