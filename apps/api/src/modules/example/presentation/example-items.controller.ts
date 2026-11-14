import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ActiveProfile, type ActiveProfileValue, RequiresProfile } from '../../identity';
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
 * Point de vue du profil actif. Le profil vient de la session (API-11) ; l'élément d'exemple n'a
 * pas de propriétaire, le lecteur est donc traité en destinataire (le cas le plus fermé). Dans un
 * vrai module, c'est `visibility` qui décide de la vue (phase 2).
 */
function viewerFor(_profile: ActiveProfileValue): ExampleViewer {
  return { role: 'recipient' };
}

/** Contrôleur mince : validation par le DTO, délégation au cas d'usage, mise en forme. */
@ApiTags('example-items')
@RequiresProfile()
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
  async getExampleItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<ExampleItemView> {
    return toExampleItemView(await this.getItem.execute({ id, viewer: viewerFor(profile) }));
  }
}
