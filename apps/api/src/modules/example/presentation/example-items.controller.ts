import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CreateExampleItem, type ExampleViewer, GetExampleItem } from '../application/contract';
import { CreateExampleItemDto } from './dto/create-example-item.dto';
import {
  type ExampleItemView,
  ExampleItemGiverView,
  ExampleItemRecipientView,
  toExampleItemView,
  toRecipientView,
} from './dto/example-item.view';

/**
 * Lecteur courant.
 * ⚠ Phase 0 : aucun profil n'existe encore, tout lecteur est traité en destinataire (le cas le
 * plus fermé). En phase 1, le profil actif vient de la session par le décorateur prévu (API-11),
 * et en phase 2 c'est `visibility` qui décide de la vue.
 */
const PHASE0_VIEWER: ExampleViewer = { role: 'recipient' };

/** Contrôleur mince : validation par le DTO, délégation au cas d'usage, mise en forme. */
@ApiTags('example-items')
@ApiExtraModels(ExampleItemRecipientView, ExampleItemGiverView)
@Controller('example-items')
export class ExampleItemsController {
  constructor(
    private readonly createItem: CreateExampleItem,
    private readonly getItem: GetExampleItem,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiCreatedResponse({ type: ExampleItemRecipientView })
  async createExampleItem(@Body() body: CreateExampleItemDto): Promise<ExampleItemRecipientView> {
    const created = await this.createItem.execute({
      title: body.title,
      ...(body.priority ? { priority: body.priority } : {}),
    });
    return toRecipientView(created);
  }

  /** Vue polymorphe : la forme dépend du lecteur, discriminée par `view` (API-12). */
  @Get(':id')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(ExampleItemRecipientView) },
        { $ref: getSchemaPath(ExampleItemGiverView) },
      ],
      discriminator: {
        propertyName: 'view',
        mapping: {
          recipient: getSchemaPath(ExampleItemRecipientView),
          giver: getSchemaPath(ExampleItemGiverView),
        },
      },
    },
  })
  async getExampleItem(@Param('id', new ParseUUIDPipe()) id: string): Promise<ExampleItemView> {
    return toExampleItemView(await this.getItem.execute({ id, viewer: PHASE0_VIEWER }));
  }
}
