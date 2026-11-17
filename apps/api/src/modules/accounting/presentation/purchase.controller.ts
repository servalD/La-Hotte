import { createHash } from 'node:crypto';
import {
  BadRequestException,
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
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ActiveProfile, type ActiveProfileValue, RequiresProfile } from '../../identity';
import {
  DecideBuyerRequest,
  GetCart,
  LowerContribution,
  MarkPurchased,
  NotifyShortfall,
  PurchaseReceipts,
  RECEIPT_UPLOAD_MAX_BYTES,
  RequestBuyer,
  UncheckPurchase,
} from '../application/contract';
import { ACCOUNTING_VIEW_SCHEMA, type ItemAccountingViewDto } from './dto/accounting.view';
import {
  CartView,
  LowerContributionDto,
  MarkPurchasedDto,
  ShortfallNoticeDto,
  UncheckPurchaseQueryDto,
} from './dto/purchase.dto';
import { toView } from './accounting.controller';
import { idempotencyOf } from './idempotency';

const UUID_PARAM = { schema: { type: 'string', format: 'uuid' } } as const;
const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'CPT-71 : clé de 8 à 128 caractères [A-Za-z0-9_-], valable 30 jours.',
} as const;

/** Fichier reçu par `multer` (mémoire seulement, jamais écrit tel quel : EXT-45). */
interface UploadedPhoto {
  readonly buffer: Buffer;
  readonly size: number;
}

/**
 * Acheteur, achat, justificatif, reste à couvrir, panier (CPT-10 à CPT-19, CPT-61 à CPT-64).
 * `404` pour qui n'a pas la compta ; `403` pour un participant à qui le geste n'appartient pas.
 */
@ApiTags('accounting')
@RequiresProfile()
@Controller()
export class PurchaseController {
  constructor(
    private readonly markPurchased: MarkPurchased,
    private readonly uncheckPurchase: UncheckPurchase,
    private readonly lower: LowerContribution,
    private readonly requestBuyer: RequestBuyer,
    private readonly decideBuyer: DecideBuyerRequest,
    private readonly shortfall: NotifyShortfall,
    private readonly receipts: PurchaseReceipts,
    private readonly cart: GetCart,
  ) {}

  /** CPT-12, CPT-13, CPT-16, CPT-17, CPT-55 */
  @Put('items/:id/purchase')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async putItemPurchase(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: MarkPurchasedDto,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    return toView(
      await this.markPurchased.execute({
        viewerId: profile.id,
        itemId: id,
        actualTotalMinor: body.actualTotalMinor ?? null,
        idempotency: idempotencyOf(profile.id, key, 'purchase.set', id, body),
      }),
    );
  }

  /** CPT-14, CPT-63 */
  @Delete('items/:id/purchase')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async deleteItemPurchase(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: UncheckPurchaseQueryDto,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    const confirm = query.confirm ?? false;
    return toView(
      await this.uncheckPurchase.execute({
        viewerId: profile.id,
        itemId: id,
        confirm,
        idempotency: idempotencyOf(profile.id, key, 'purchase.remove', id, { confirm }),
      }),
    );
  }

  /** CPT-18 */
  @Post('items/:id/contribution/lower')
  @HttpCode(200)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async lowerItemContribution(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: LowerContributionDto,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    return toView(
      await this.lower.execute({
        viewerId: profile.id,
        itemId: id,
        amountMinor: body.amountMinor,
        idempotency: idempotencyOf(profile.id, key, 'contribution.lower', id, body),
      }),
    );
  }

  /** CPT-19 */
  @Post('items/:id/shortfall-notice')
  @HttpCode(200)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async postItemShortfallNotice(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ShortfallNoticeDto,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    return toView(
      await this.shortfall.execute({
        viewerId: profile.id,
        itemId: id,
        profileIds: body.profileIds,
        idempotency: idempotencyOf(profile.id, key, 'shortfall.notice', id, body),
      }),
    );
  }

  /** CPT-61 */
  @Post('items/:id/buyer-requests')
  @HttpCode(200)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async postItemBuyerRequest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    return toView(
      await this.requestBuyer.execute({
        viewerId: profile.id,
        itemId: id,
        idempotency: idempotencyOf(profile.id, key, 'buyer.request', id, null),
      }),
    );
  }

  /** CPT-61 */
  @Post('buyer-requests/:id/accept')
  @HttpCode(200)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async acceptBuyerRequest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    return toView(
      await this.decideBuyer.execute({
        viewerId: profile.id,
        requestId: id,
        decision: 'ACCEPTED',
        idempotency: idempotencyOf(profile.id, key, 'buyer.accept', id, null),
      }),
    );
  }

  /** CPT-61 */
  @Post('buyer-requests/:id/refuse')
  @HttpCode(200)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async refuseBuyerRequest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    return toView(
      await this.decideBuyer.execute({
        viewerId: profile.id,
        requestId: id,
        decision: 'REFUSED',
        idempotency: idempotencyOf(profile.id, key, 'buyer.refuse', id, null),
      }),
    );
  }

  /** CPT-61 : le candidat retire sa demande. */
  @Delete('buyer-requests/:id')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async cancelBuyerRequest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    return toView(
      await this.decideBuyer.execute({
        viewerId: profile.id,
        requestId: id,
        decision: 'CANCELLED',
        idempotency: idempotencyOf(profile.id, key, 'buyer.cancel', id, null),
      }),
    );
  }

  /** CPT-15, CPT-62 : photo ré-encodée sans métadonnées, par l'acheteur. */
  @Put('items/:id/purchase/receipt')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: RECEIPT_UPLOAD_MAX_BYTES, files: 1, fields: 0 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['photo'],
      properties: { photo: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ schema: ACCOUNTING_VIEW_SCHEMA })
  async putItemPurchaseReceipt(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() photo: UploadedPhoto | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ItemAccountingViewDto> {
    if (!photo || photo.size === 0) throw new BadRequestException();
    const digest = createHash('sha256').update(photo.buffer).digest('hex');
    return toView(
      await this.receipts.attach({
        viewerId: profile.id,
        itemId: id,
        photo: photo.buffer,
        idempotency: idempotencyOf(profile.id, key, 'receipt.set', id, { digest }),
      }),
    );
  }

  /** CPT-59, CPT-62 : servi aux seuls participants. */
  @Get('items/:id/purchase/receipt')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiProduces('image/webp', 'image/jpeg', 'image/png')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async getItemPurchaseReceipt(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const image = await this.receipts.read(profile.id, id);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(image.bytes, { type: image.contentType });
  }

  /** CPT-11 */
  @Get('cart')
  @ApiOkResponse({ type: CartView })
  async getCart(@ActiveProfile() profile: ActiveProfileValue): Promise<CartView> {
    const groups = await this.cart.execute(profile.id);
    return {
      groups: groups.map((group) => ({
        event: group.event ? { id: group.event.id, title: group.event.title } : null,
        recipients: group.recipients.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          avatar: p.avatar,
          accentColor: p.accentColor,
        })),
        items: group.items.map((line) => ({
          accountingId: line.accountingId,
          itemId: line.itemId,
          title: line.title,
          sourceUrl: line.sourceUrl,
          quantity: line.quantity,
          currency: line.currency,
          totalMinor: line.totalMinor,
          coveredMinor: line.coveredMinor,
          remainingMinor: line.remainingMinor,
          myShareMinor: line.myShareMinor,
          purchased: line.purchased,
        })),
      })),
    };
  }
}
