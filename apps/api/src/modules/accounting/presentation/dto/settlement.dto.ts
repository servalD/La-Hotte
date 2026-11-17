import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { MAX_MINOR } from '../../application/contract';
import { AccountingPersonView } from './accounting.view';

const SETTLEMENTS = ['NONE', 'DUE', 'CLAIMED', 'SETTLED'] as const;
const MODES = ['FULL', 'PERCENT', 'FIXED'] as const;

/** CPT-20, CPT-21, CPT-24, CPT-65 : réglée (ou avancée), ou règlement annulé. */
export class SetSettlementDto {
  @ApiProperty() @IsBoolean() settled!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 60 })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(60)
  note?: string | null;
}

/** CPT-68 */
export class ProposeOffsetDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() counterpartId!: string;
  @ApiProperty({ pattern: '^[A-Z]{3}$' }) @Matches(/^[A-Z]{3}$/) currency!: string;
}

export class BalancesQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() eventId?: string;
}

/** CPT-40, CPT-69 */
export class PutBudgetDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() eventId!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  recipientId?: string | null;

  @ApiProperty({ minimum: 1, maximum: MAX_MINOR })
  @IsInt()
  @Min(1)
  @Max(MAX_MINOR)
  amountMinor!: number;

  @ApiProperty({ pattern: '^[A-Z]{3}$' }) @Matches(/^[A-Z]{3}$/) currency!: string;
}

export class OffsetProposalView {
  @ApiProperty({ format: 'uuid' }) id!: string;
}

/** CPT-75 : proposition en attente, reçue ou envoyée. */
export class PendingOffsetView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['SENT', 'RECEIVED'], enumName: 'OffsetDirection' })
  direction!: 'SENT' | 'RECEIVED';
  @ApiProperty({ type: AccountingPersonView, nullable: true }) other!: AccountingPersonView | null;
  @ApiProperty() currency!: string;
  @ApiProperty() amountMinor!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class PendingOffsetsView {
  @ApiProperty({ type: [PendingOffsetView] }) items!: PendingOffsetView[];
}

export class OffsetDecisionView {
  @ApiProperty({ enum: ['CONFIRMED', 'DECLINED'] }) status!: 'CONFIRMED' | 'DECLINED';
}

export class BalanceLineView {
  @ApiProperty({ format: 'uuid' }) contributionId!: string;
  @ApiProperty({ format: 'uuid' }) accountingId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) itemId!: string | null;
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'uuid' }) participantId!: string;
  @ApiProperty({ format: 'uuid' }) buyerId!: string;
  @ApiProperty() owedMinor!: number;
  @ApiProperty({ enum: SETTLEMENTS, enumName: 'SettlementState' })
  settlement!: (typeof SETTLEMENTS)[number];
}

/** CPT-30, CPT-31 : solde avec un autre profil, dans une devise (CPT-33). */
export class BalanceView {
  @ApiProperty({ type: AccountingPersonView, nullable: true }) other!: AccountingPersonView | null;
  @ApiProperty() currency!: string;
  @ApiProperty() iOweMinor!: number;
  @ApiProperty() owesMeMinor!: number;
  @ApiProperty() netMinor!: number;
  @ApiProperty({ type: [BalanceLineView] }) lines!: BalanceLineView[];
}

export class BalancesView {
  @ApiProperty({ type: [BalanceView] }) items!: BalanceView[];
}

export class BudgetView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) recipientId!: string | null;
  @ApiProperty() amountMinor!: number;
  @ApiProperty() currency!: string;
}

export class BudgetsView {
  @ApiProperty({ type: [BudgetView] }) items!: BudgetView[];
}

export class MoneyView {
  @ApiProperty() currency!: string;
  @ApiProperty() amountMinor!: number;
}

export class OverviewLineView {
  @ApiProperty({ format: 'uuid' }) accountingId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) itemId!: string | null;
  @ApiProperty() title!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: MODES, enumName: 'ContributionMode' }) mode!: (typeof MODES)[number];
  @ApiProperty({ type: Number, nullable: true }) amountMinor!: number | null;
  @ApiProperty() isBuyer!: boolean;
  @ApiProperty({ type: AccountingPersonView, nullable: true }) buyer!: AccountingPersonView | null;
  @ApiProperty() purchased!: boolean;
  @ApiProperty({ enum: SETTLEMENTS, enumName: 'SettlementState' })
  settlement!: (typeof SETTLEMENTS)[number];
}

export class OverviewGroupView {
  @ApiProperty({ type: [AccountingPersonView] }) recipients!: AccountingPersonView[];
  @ApiProperty({ type: String, nullable: true }) month!: string | null;
  @ApiProperty({ type: Number, nullable: true }) budgetMinor!: number | null;
  @ApiProperty({ type: [MoneyView] }) totals!: MoneyView[];
  @ApiProperty({ type: [OverviewLineView] }) lines!: OverviewLineView[];
}

export class OverviewEventView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
}

/** CPT-41 à CPT-45 : vue latérale. */
export class AccountingOverviewView {
  @ApiProperty({ type: OverviewEventView, nullable: true }) event!: OverviewEventView | null;
  @ApiProperty({ type: MoneyView, nullable: true }) budget!: MoneyView | null;
  @ApiProperty({ type: [MoneyView] }) engaged!: MoneyView[];
  @ApiProperty({ type: [OverviewGroupView] }) groups!: OverviewGroupView[];
  @ApiProperty({ type: [AccountingPersonView] }) nothingYet!: AccountingPersonView[];
}
