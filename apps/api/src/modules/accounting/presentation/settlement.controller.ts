import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { ActiveProfile, type ActiveProfileValue, RequiresProfile } from '../../identity';
import {
  GetAccountingOverview,
  GetBalances,
  ManageBudgets,
  ManageOffsets,
  SettleContribution,
  type BalanceSummary,
} from '../application/contract';
import { toView } from './accounting.controller';
import { ACCOUNTING_VIEW_SCHEMA, type ItemAccountingViewDto } from './dto/accounting.view';
import {
  AccountingOverviewView,
  BalancesQueryDto,
  BalancesView,
  BudgetsView,
  BudgetView,
  OffsetDecisionView,
  OffsetProposalView,
  PendingOffsetsView,
  ProposeOffsetDto,
  PutBudgetDto,
  SetSettlementDto,
} from './dto/settlement.dto';
import { idempotencyOf } from './idempotency';

const UUID_PARAM = { schema: { type: 'string', format: 'uuid' } } as const;
const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'CPT-71 : clé de 8 à 128 caractères [A-Za-z0-9_-], valable 30 jours.',
} as const;

type Card = { id: string; displayName: string; avatar: string | null; accentColor: string };
const person = (c: Card) => ({
  id: c.id,
  displayName: c.displayName,
  avatar: c.avatar,
  accentColor: c.accentColor,
});

/**
 * Règlements, soldes, compensation, budgets, vue latérale (CPT-20 à CPT-45, CPT-65 à CPT-69).
 * Une part n'existe que pour son participant et l'acheteur (`404` sinon, CPT-59) ; un budget, que
 * pour son profil (CPT-40).
 */
@ApiTags('accounting')
@RequiresProfile()
@Controller()
export class SettlementController {
  constructor(
    private readonly settlements: SettleContribution,
    private readonly balances: GetBalances,
    private readonly offsets: ManageOffsets,
    private readonly budgets: ManageBudgets,
    private readonly overview: GetAccountingOverview,
  ) {}

  /** CPT-20, CPT-21, CPT-24, CPT-65 */
  @Put('contributions/:id/settlement')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async putContributionSettlement(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SetSettlementDto,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    return toView(
      await this.settlements.settle({
        viewerId: profile.id,
        contributionId: id,
        settled: body.settled,
        note: body.note ?? null,
        idempotency: idempotencyOf(profile.id, key, 'settlement.set', id, body),
      }),
    );
  }

  /** CPT-22 */
  @Post('contributions/:id/claim')
  @HttpCode(200)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async claimContributionSettlement(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    return toView(
      await this.settlements.claim({
        viewerId: profile.id,
        contributionId: id,
        idempotency: idempotencyOf(profile.id, key, 'settlement.claim', id, null),
      }),
    );
  }

  /** CPT-23, CPT-66 */
  @Post('contributions/:id/nudge')
  @HttpCode(200)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async nudgeContribution(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    return toView(
      await this.settlements.nudge({
        viewerId: profile.id,
        contributionId: id,
        idempotency: idempotencyOf(profile.id, key, 'settlement.nudge', id, null),
      }),
    );
  }

  /** CPT-30 à CPT-33, CPT-67 */
  @Get('balances')
  @ApiOkResponse({ type: BalancesView })
  async getBalances(
    @Query() query: BalancesQueryDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<BalancesView> {
    return toBalancesView(await this.balances.execute(profile.id, query.eventId ?? null));
  }

  /** CPT-75 */
  @Get('offset-proposals')
  @ApiOkResponse({ type: PendingOffsetsView })
  async listOffsetProposals(
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<PendingOffsetsView> {
    const rows = await this.offsets.list(profile.id);
    return {
      items: rows.map((row) => ({
        id: row.id,
        direction: row.direction,
        other: row.other ? person(row.other) : null,
        currency: row.currency,
        amountMinor: row.amountMinor,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /** CPT-31, CPT-68 */
  @Post('offset-proposals')
  @HttpCode(200)
  @ApiOkResponse({ type: OffsetProposalView })
  async proposeOffset(
    @Body() body: ProposeOffsetDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<OffsetProposalView> {
    return this.offsets.propose({
      viewerId: profile.id,
      counterpartId: body.counterpartId,
      currency: body.currency,
    });
  }

  /** CPT-68 : confirmée par l'autre profil seulement. */
  @Post('offset-proposals/:id/confirm')
  @HttpCode(200)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ type: OffsetDecisionView })
  async confirmOffset(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<OffsetDecisionView> {
    return this.offsets.decide({
      viewerId: profile.id,
      proposalId: id,
      confirm: true,
      idempotency: idempotencyOf(profile.id, key, 'offset.confirm', id, null),
    });
  }

  /** CPT-68 */
  @Post('offset-proposals/:id/decline')
  @HttpCode(200)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ type: OffsetDecisionView })
  async declineOffset(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<OffsetDecisionView> {
    return this.offsets.decide({
      viewerId: profile.id,
      proposalId: id,
      confirm: false,
      idempotency: idempotencyOf(profile.id, key, 'offset.decline', id, null),
    });
  }

  /** CPT-40, CPT-69 */
  @Get('budgets')
  @ApiOkResponse({ type: BudgetsView })
  async listBudgets(
    @Query() query: BalancesQueryDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<BudgetsView> {
    const rows = await this.budgets.list(profile.id, query.eventId ?? null);
    return { items: rows.map(toBudgetView) };
  }

  /** CPT-40, CPT-69 */
  @Put('budgets')
  @ApiOkResponse({ type: BudgetView })
  async putBudget(
    @Body() body: PutBudgetDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<BudgetView> {
    return toBudgetView(
      await this.budgets.put({
        viewerId: profile.id,
        eventId: body.eventId,
        recipientId: body.recipientId ?? null,
        amountMinor: body.amountMinor,
        currency: body.currency,
      }),
    );
  }

  /** CPT-40 */
  @Delete('budgets/:id')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async deleteBudget(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.budgets.delete(profile.id, id);
  }

  /** CPT-41 à CPT-45 */
  @Get('accounting/overview')
  @ApiOkResponse({ type: AccountingOverviewView })
  async getAccountingOverview(
    @Query() query: BalancesQueryDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<AccountingOverviewView> {
    const o = await this.overview.execute(profile.id, query.eventId ?? null);
    return {
      event: o.event ? { id: o.event.id, title: o.event.title } : null,
      budget: o.budget ? { amountMinor: o.budget.amountMinor, currency: o.budget.currency } : null,
      engaged: o.engaged.map((m) => ({ currency: m.currency, amountMinor: m.amountMinor })),
      groups: o.groups.map((g) => ({
        recipients: g.recipients.map(person),
        month: g.month,
        budgetMinor: g.budgetMinor,
        totals: g.totals.map((m) => ({ currency: m.currency, amountMinor: m.amountMinor })),
        lines: g.lines.map((l) => ({
          accountingId: l.accountingId,
          itemId: l.itemId,
          title: l.title,
          currency: l.currency,
          mode: l.mode,
          amountMinor: l.amountMinor,
          isBuyer: l.isBuyer,
          buyer: l.buyer ? person(l.buyer) : null,
          purchased: l.purchased,
          settlement: l.settlement,
        })),
      })),
      nothingYet: o.nothingYet.map(person),
    };
  }
}

/** CPT-30 à CPT-33 : vue des comptes, champ par champ (aussi pour l'export, RGPD-11). */
export function toBalancesView(balances: readonly BalanceSummary[]): BalancesView {
  return {
    items: balances.map((b) => ({
      other: b.other ? person(b.other) : null,
      currency: b.currency,
      iOweMinor: b.iOweMinor,
      owesMeMinor: b.owesMeMinor,
      netMinor: b.netMinor,
      lines: b.lines.map((l) => ({
        contributionId: l.contributionId,
        accountingId: l.accountingId,
        itemId: l.itemId,
        title: l.title,
        participantId: l.participantId,
        buyerId: l.buyerId,
        owedMinor: l.owedMinor,
        settlement: l.settlement,
      })),
    })),
  };
}

/** CPT-40 : vue d'un budget (aussi pour l'export, RGPD-11). */
export function toBudgetView(b: {
  id: string;
  eventId: string;
  recipientId: string | null;
  amountMinor: number;
  currency: string;
}): BudgetView {
  return {
    id: b.id,
    eventId: b.eventId,
    recipientId: b.recipientId,
    amountMinor: b.amountMinor,
    currency: b.currency,
  };
}
