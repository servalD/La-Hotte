import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { ActiveProfile, type ActiveProfileValue, RequiresProfile } from '../../identity';
import {
  CopyFromDirectory,
  SearchDirectory,
  ShareProduct,
} from '../application/directory.use-cases';
import { DirectoryQueryDto, ShareProductDto } from './dto/directory.dto';
import { CopiedDirectoryProductView, DirectoryView, SharedProductView } from './dto/directory.view';

const UUID_PARAM = { schema: { type: 'string', format: 'uuid' } } as const;

/** Partage d'une fiche du profil actif (REP-02, REP-06, REP-08, REP-09). */
@ApiTags('products')
@RequiresProfile()
@Controller('products')
export class ProductShareController {
  constructor(private readonly share: ShareProduct) {}

  @Put(':id/share')
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiOkResponse({ type: SharedProductView })
  async shareProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ShareProductDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<SharedProductView> {
    const product = await this.share.execute({
      viewerId: profile.id,
      productId: id,
      level: body.level,
      hiddenItemChoice: body.hiddenItemChoice ?? null,
    });
    return { productId: product.id, shareLevel: product.shareLevel, version: product.version };
  }
}

/** Répertoire du cercle (REP-01 à REP-10, VIS-40). */
@ApiTags('directory')
@RequiresProfile()
@Controller('directory')
export class DirectoryController {
  constructor(
    private readonly search: SearchDirectory,
    private readonly copy: CopyFromDirectory,
  ) {}

  @Get()
  @ApiOkResponse({ type: DirectoryView })
  async searchDirectory(
    @Query() query: DirectoryQueryDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<DirectoryView> {
    const products = await this.search.execute({
      viewerId: profile.id,
      query: query.q ?? null,
      limit: query.limit ?? 50,
    });
    return {
      items: products.map((p) => ({
        productId: p.id,
        title: p.title,
        description: p.description,
        imageKey: p.imageKey,
        unitPriceMinor: p.unitPriceMinor,
        currency: p.currency,
        merchant: p.merchant,
        sourceUrl: p.sourceUrl,
        sharedBy: p.ownerProfileId,
      })),
    };
  }

  /** REP-05 : la copie va dans mes fiches ; je l'ajoute ensuite à ma liste. */
  @Post(':productId/copy')
  @ApiParam({ name: 'productId', ...UUID_PARAM })
  @ApiCreatedResponse({ type: CopiedDirectoryProductView })
  async copyFromDirectory(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<CopiedDirectoryProductView> {
    const copy = await this.copy.execute({ viewerId: profile.id, productId });
    return { productId: copy.id };
  }
}
