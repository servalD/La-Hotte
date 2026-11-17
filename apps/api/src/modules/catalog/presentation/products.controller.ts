import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ActiveProfile, type ActiveProfileValue, RequiresProfile } from '../../identity';
import { Idempotent } from '../../../platform/http/idempotency';
import { parseIfMatch } from '../../../platform/http/if-match';
import {
  CreateProduct,
  CreateProductFromLink,
  CreateProductFromPhoto,
  GetImage,
  IMAGE_UPLOAD_MAX_BYTES,
  GetOwnProduct,
  ListOwnProducts,
  type Product,
  UpdateProduct,
} from '../application/contract';
import {
  CreateProductDto,
  PhotoProductDto,
  ProductPageQueryDto,
  UpdateProductDto,
} from './dto/product.dto';

/** Fichier reçu par `multer` (mémoire seulement, jamais écrit tel quel : EXT-45). */
interface UploadedPhoto {
  readonly buffer: Buffer;
  readonly size: number;
}
import { ProductPageView, ProductView } from './dto/product.view';

export function toProductView(product: Product): ProductView {
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    imageKey: product.imageKey,
    unitPriceMinor: product.unitPriceMinor,
    currency: product.currency,
    merchant: product.merchant,
    sourceUrl: product.sourceUrl,
    source: product.source,
    shareLevel: product.shareLevel,
    extractionStatus: product.extractionStatus,
    uncertainFields: [...product.uncertainFields],
    extractionTruncated: product.extractionTruncated,
    priceCheckedAt: product.priceCheckedAt?.toISOString() ?? null,
    createdAt: product.createdAt.toISOString(),
    version: product.version,
  };
}

/** Fiches du profil actif (ART-01 à ART-06). Toute autre fiche : `404` (ART-05, SEC-04). */
@ApiTags('products')
@RequiresProfile()
@Controller('products')
export class ProductsController {
  constructor(
    private readonly create: CreateProduct,
    private readonly get: GetOwnProduct,
    private readonly list: ListOwnProducts,
    private readonly update: UpdateProduct,
    private readonly fromLink: CreateProductFromLink,
    private readonly fromPhoto: CreateProductFromPhoto,
  ) {}

  @Post()
  @Idempotent('product.create')
  @ApiCreatedResponse({ type: ProductView })
  async createProduct(
    @Body() body: CreateProductDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ProductView> {
    if (body.url !== undefined) {
      // Par lien : le reste de la fiche vient de l'extraction (EXT-04), pas du corps.
      const extra = Object.entries(body).filter(
        ([key, value]) => value !== undefined && key !== 'url' && key !== 'currency',
      );
      if (extra.length > 0) {
        throw new BadRequestException();
      }
      const draft = await this.fromLink.execute({
        ownerProfileId: profile.id,
        accountId: profile.accountId,
        url: body.url,
        currency: body.currency ?? 'EUR',
      });
      return toProductView(draft);
    }
    if (body.title === undefined) throw new BadRequestException();
    const product = await this.create.execute({
      ownerProfileId: profile.id,
      fields: {
        title: body.title,
        description: body.description ?? '',
        unitPriceMinor: body.unitPriceMinor ?? null,
        currency: body.currency ?? 'EUR',
        merchant: body.merchant ?? null,
        sourceUrl: body.sourceUrl ?? null,
      },
    });
    return toProductView(product);
  }

  /** EXT-10, EXT-11 : photo réencodée sans métadonnées par le fetcher, puis extraction. */
  @Post('photo')
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: IMAGE_UPLOAD_MAX_BYTES, files: 1, fields: 2 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['photo'],
      properties: {
        photo: { type: 'string', format: 'binary' },
        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
      },
    },
  })
  @ApiCreatedResponse({ type: ProductView })
  async createProductFromPhoto(
    @UploadedFile() photo: UploadedPhoto | undefined,
    @Body() body: PhotoProductDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ProductView> {
    if (!photo || photo.size === 0) throw new BadRequestException();
    const draft = await this.fromPhoto.execute({
      ownerProfileId: profile.id,
      accountId: profile.accountId,
      photo: photo.buffer,
      currency: body.currency ?? 'EUR',
    });
    return toProductView(draft);
  }

  @Get()
  @ApiOkResponse({ type: ProductPageView })
  async listOwnProducts(
    @Query() query: ProductPageQueryDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ProductPageView> {
    const page = await this.list.execute({
      ownerProfileId: profile.id,
      cursor: query.cursor ?? null,
      limit: query.limit ?? 50,
    });
    return { items: page.items.map(toProductView), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ type: ProductView })
  async getOwnProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductView> {
    const product = await this.get.execute({ ownerProfileId: profile.id, productId: id });
    response.setHeader('ETag', `"${product.version}"`);
    return toProductView(product);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiHeader({ name: 'If-Match', required: true, description: 'Version lue (API-17).' })
  @ApiOkResponse({ type: ProductView })
  async updateProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateProductDto,
    @Headers('if-match') ifMatch: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ProductView> {
    const product = await this.update.execute({
      ownerProfileId: profile.id,
      productId: id,
      expectedVersion: parseIfMatch(ifMatch),
      changes: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.unitPriceMinor !== undefined ? { unitPriceMinor: body.unitPriceMinor } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(body.merchant !== undefined ? { merchant: body.merchant } : {}),
        ...(body.sourceUrl !== undefined ? { sourceUrl: body.sourceUrl } : {}),
      },
    });
    return toProductView(product);
  }
}

/** EXT-47 : image réencodée, servie à un profil actif qui en connaît la clé. */
@ApiTags('images')
@RequiresProfile()
@Controller('images')
export class ImagesController {
  constructor(private readonly image: GetImage) {}

  @Get(':key')
  @ApiParam({ name: 'key', schema: { type: 'string', pattern: '^[0-9a-f]{32}$' } })
  @ApiProduces('image/webp', 'image/jpeg', 'image/png')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async getImage(
    @Param('key') key: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const image = await this.image.execute(key);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(image.bytes, { type: image.contentType });
  }
}
