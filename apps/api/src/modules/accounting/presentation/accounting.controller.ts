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
} from '@nestjs/common';
import { ApiExtraModels, ApiHeader, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { ActiveProfile, type ActiveProfileValue, RequiresProfile } from '../../identity';
import {
  AccountingViews,
  type AccountingViewModel,
  type ContributionInput,
  DecideAccountingReview,
  RemoveContribution,
  SetAccountingOptions,
  SetContribution,
} from '../application/contract';
import { AccountingOptionsDto, SetContributionDto } from './dto/accounting.dto';
import {
  ACCOUNTING_VIEW_SCHEMA,
  ItemAccountingGiverView,
  ItemAccountingParticipantView,
  type ItemAccountingViewDto,
} from './dto/accounting.view';
import { idempotencyOf } from './idempotency';

const UUID_PARAM = { schema: { type: 'string', format: 'uuid' } } as const;
const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'CPT-71 : clé de 8 à 128 caractères [A-Za-z0-9_-], valable 30 jours.',
} as const;

type Card = { id: string; displayName: string; avatar: string | null; accentColor: string } | null;

const person = (card: Card) =>
  card
    ? {
        id: card.id,
        displayName: card.displayName,
        avatar: card.avatar,
        accentColor: card.accentColor,
      }
    : null;

/** Vue champ par champ (CPT-59) : jamais `...model`. */
export function toView(model: AccountingViewModel): ItemAccountingViewDto {
  const common = {
    accountingId: model.accountingId,
    itemId: model.itemId,
    title: model.title,
    currency: model.currency,
    plannedTotalMinor: model.plannedTotalMinor,
    itemTotalMinor: model.itemTotalMinor,
    coveredMinor: model.coveredMinor,
    remainingMinor: model.remainingMinor,
    buyer: person(model.buyer),
    purchased: model.purchased,
    canContribute: model.canContribute,
  };
  if (model.view === 'giver') {
    return {
      view: 'giver',
      ...common,
      participants: model.participants.map((line) => ({
        person: person(line.person),
        mode: line.mode,
        rank: line.rank,
        isBuyer: line.isBuyer,
      })),
    };
  }
  return {
    view: 'participant',
    ...common,
    participants: model.participants.map((line) => ({
      person: person(line.person),
      mode: line.mode,
      rank: line.rank,
      isBuyer: line.isBuyer,
      amountMinor: line.amountMinor,
      units: line.units,
      mine: line.mine,
    })),
    mine: model.mine
      ? {
          id: model.mine.id,
          mode: model.mine.mode,
          share: model.mine.share ? { num: model.mine.share.num, den: model.mine.share.den } : null,
          units: model.mine.units,
          amountMinor: model.mine.amountMinor,
          rank: model.mine.rank,
          settlement: model.mine.settlement,
          settledMinor: model.mine.settledMinor,
        }
      : null,
    isBuyer: model.isBuyer,
    reviewEnabled: model.reviewEnabled,
    receiptEnabled: model.receiptEnabled,
    reviews: model.reviews.map((review) => ({
      id: review.id,
      kind: review.kind,
      author: person(review.author),
      proposedTotalMinor: review.proposedTotalMinor,
      proposedReviewEnabled: review.proposedReviewEnabled,
      proposedReceiptEnabled: review.proposedReceiptEnabled,
      createdAt: review.createdAt,
      canDecide: review.canDecide,
    })),
    // Une réponse rejouée (CPT-71) peut dater d'avant ces champs.
    buyerRequest: model.buyerRequest
      ? {
          id: model.buyerRequest.id,
          candidate: person(model.buyerRequest.candidate),
          mine: model.buyerRequest.mine,
          canDecide: model.buyerRequest.canDecide,
          createdAt: model.buyerRequest.createdAt,
        }
      : null,
    hasReceipt: model.hasReceipt ?? false,
  };
}

function toInput(dto: SetContributionDto): ContributionInput {
  switch (dto.mode) {
    case 'FULL':
      return { mode: 'FULL' };
    case 'PERCENT':
      return { mode: 'PERCENT', share: { num: dto.shareNum ?? 0, den: dto.shareDen ?? 0 } };
    case 'FIXED':
      return { mode: 'FIXED', amountMinor: dto.amountMinor ?? 0 };
    case 'UNITS':
      return { mode: 'UNITS', units: dto.units ?? 0 };
  }
}

/**
 * Compta d'un élément (07). `404` pour qui n'a pas la compta, destinataire compris (CPT-59,
 * VIS-20) ; le profil vient de la session ; toute mutation exige `Idempotency-Key` (CPT-71).
 */
@ApiTags('accounting')
@ApiExtraModels(ItemAccountingGiverView, ItemAccountingParticipantView)
@RequiresProfile()
@Controller()
export class AccountingController {
  constructor(
    private readonly views: AccountingViews,
    private readonly setContribution: SetContribution,
    private readonly removeContribution: RemoveContribution,
    private readonly setOptions: SetAccountingOptions,
    private readonly decideReview: DecideAccountingReview,
  ) {}

  /** CPT-59 */
  @Get('items/:id/accounting')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async getItemAccounting(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    return toView(await this.views.forItem(profile.id, id));
  }

  /** CPT-01 à CPT-07, CPT-53 à CPT-57, CPT-60 */
  @Put('items/:id/contribution')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async putItemContribution(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SetContributionDto,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    return toView(
      await this.setContribution.execute({
        viewerId: profile.id,
        itemId: id,
        contribution: toInput(body),
        idempotency: idempotencyOf(profile.id, key, 'contribution.set', id, body),
      }),
    );
  }

  /** CPT-06, CPT-65, CPT-72, CPT-73 */
  @Delete('items/:id/contribution')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async deleteItemContribution(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    return toView(
      await this.removeContribution.execute({
        viewerId: profile.id,
        itemId: id,
        idempotency: idempotencyOf(profile.id, key, 'contribution.remove', id, null),
      }),
    );
  }

  /** CPT-58 */
  @Put('items/:id/accounting/options')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async putItemAccountingOptions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AccountingOptionsDto,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    return toView(
      await this.setOptions.execute({
        viewerId: profile.id,
        itemId: id,
        options: { reviewEnabled: body.reviewEnabled, receiptEnabled: body.receiptEnabled },
        idempotency: idempotencyOf(profile.id, key, 'accounting.options', id, body),
      }),
    );
  }

  /** CPT-58 */
  @Post('accounting-reviews/:id/approve')
  @HttpCode(200)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async approveAccountingReview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    return toView(
      await this.decideReview.execute({
        viewerId: profile.id,
        reviewId: id,
        approve: true,
        idempotency: idempotencyOf(profile.id, key, 'review.approve', id, null),
      }),
    );
  }

  /** CPT-58 */
  @Post('accounting-reviews/:id/refuse')
  @HttpCode(200)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async refuseAccountingReview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    return toView(
      await this.decideReview.execute({
        viewerId: profile.id,
        reviewId: id,
        approve: false,
        idempotency: idempotencyOf(profile.id, key, 'review.refuse', id, null),
      }),
    );
  }
}
