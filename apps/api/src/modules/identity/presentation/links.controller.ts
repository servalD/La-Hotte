import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  type ActiveProfile as ActiveProfileValue,
  ApproveLink,
  BlockProfile,
  BreakLink,
  CreateInvitation,
  InspectInvitation,
  ListBlocks,
  ListCircle,
  ListInvitations,
  ListLinks,
  RedeemInvitation,
  RevokeInvitation,
  UnblockProfile,
} from '../application/contract';
import {
  ActiveProfile,
  ClientContext,
  type ClientContextValue,
  RequiresProfile,
} from './decorators';
import { BlockProfileDto, CreateInvitationDto, InvitationTokenDto } from './dto/link.dto';
import {
  BlockListView,
  CircleView,
  CreatedInvitationView,
  InvitationListView,
  InvitationPreviewView,
  LinkListView,
  RedeemedInvitationView,
} from './dto/link.view';

/**
 * Cercle du profil actif (LNK-09). Aucune route de recherche de profils (LNK-04) : on ne lit que
 * son cercle. Le profil vient de la session (API-11).
 */
@ApiTags('circle')
@RequiresProfile()
@Controller('circle')
export class CircleController {
  constructor(private readonly circle: ListCircle) {}

  @Get()
  @ApiOkResponse({ type: CircleView })
  async getCircle(@ActiveProfile() profile: ActiveProfileValue): Promise<CircleView> {
    const members = await this.circle.execute(profile);
    return { items: members.map((member) => ({ ...member })) };
  }
}

/** Liens du profil actif, et ceux de ses enfants à valider (LNK-02, LNK-06). */
@ApiTags('links')
@RequiresProfile()
@Controller('links')
export class LinksController {
  constructor(
    private readonly list: ListLinks,
    private readonly approve: ApproveLink,
    private readonly breakLink: BreakLink,
  ) {}

  @Get()
  @ApiOkResponse({ type: LinkListView })
  async listLinks(@ActiveProfile() profile: ActiveProfileValue): Promise<LinkListView> {
    const links = await this.list.execute(profile);
    return {
      items: links.map((link) => ({
        id: link.id,
        status: link.status,
        role: link.role,
        counterpart: link.counterpart,
        child: link.child,
        awaitingMyApproval: link.awaitingMyApproval,
        createdAt: link.createdAt.toISOString(),
      })),
    };
  }

  /** LNK-06 : `404` pour tout lien que le profil actif n'a pas à valider (SEC-04). */
  @Post(':id/approve')
  @HttpCode(204)
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiNoContentResponse()
  async approveLink(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.approve.execute({ active: profile, linkId: id, client });
  }

  /** LNK-02 : rompre, ou refuser un lien en attente ; les accès tombent à la requête suivante. */
  @Delete(':id')
  @HttpCode(204)
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiNoContentResponse()
  async deleteLink(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.breakLink.execute({ active: profile, linkId: id, client });
  }
}

/** Invitations à un lien (LNK-01, LNK-06, LNK-07). Aucune route publique. */
@ApiTags('invitations')
@RequiresProfile()
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly create: CreateInvitation,
    private readonly list: ListInvitations,
    private readonly revoke: RevokeInvitation,
    private readonly inspect: InspectInvitation,
    private readonly redeem: RedeemInvitation,
  ) {}

  /** Le jeton n'est rendu qu'ici, une seule fois. */
  @Post()
  @ApiCreatedResponse({ type: CreatedInvitationView })
  async createInvitation(
    @Body() body: CreateInvitationDto,
    @ActiveProfile() profile: ActiveProfileValue,
    @ClientContext() client: ClientContextValue,
  ): Promise<CreatedInvitationView> {
    const created = await this.create.execute({
      active: profile,
      ...(body.email ? { email: body.email } : {}),
      client,
    });
    return { id: created.id, token: created.token, expiresAt: created.expiresAt.toISOString() };
  }

  @Get()
  @ApiOkResponse({ type: InvitationListView })
  async listInvitations(@ActiveProfile() profile: ActiveProfileValue): Promise<InvitationListView> {
    const invitations = await this.list.execute(profile);
    return {
      items: invitations.map((invitation) => ({
        id: invitation.id,
        createdAt: invitation.createdAt.toISOString(),
        expiresAt: invitation.expiresAt.toISOString(),
      })),
    };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiNoContentResponse()
  async revokeInvitation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.revoke.execute({ active: profile, invitationId: id, client });
  }

  /** LNK-07 : le jeton dans le corps, jamais dans l'adresse (journaux, historique). */
  @Post('inspect')
  @HttpCode(200)
  @ApiOkResponse({ type: InvitationPreviewView })
  async inspectInvitation(
    @Body() body: InvitationTokenDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<InvitationPreviewView> {
    const preview = await this.inspect.execute({ active: profile, token: body.token });
    return {
      inviterName: preview.inviterName,
      inviterAccentColor: preview.inviterAccentColor,
      expiresAt: preview.expiresAt.toISOString(),
    };
  }

  /** LNK-06 : accepté d'office, ou en attente d'un tuteur si un enfant est partie. */
  @Post('redeem')
  @ApiCreatedResponse({ type: RedeemedInvitationView })
  async redeemInvitation(
    @Body() body: InvitationTokenDto,
    @ActiveProfile() profile: ActiveProfileValue,
    @ClientContext() client: ClientContextValue,
  ): Promise<RedeemedInvitationView> {
    return this.redeem.execute({ active: profile, token: body.token, client });
  }
}

/** Blocages du profil actif (LNK-05). Jamais exposés au profil bloqué. */
@ApiTags('blocks')
@RequiresProfile()
@Controller('blocks')
export class BlocksController {
  constructor(
    private readonly list: ListBlocks,
    private readonly block: BlockProfile,
    private readonly unblock: UnblockProfile,
  ) {}

  @Get()
  @ApiOkResponse({ type: BlockListView })
  async listBlocks(@ActiveProfile() profile: ActiveProfileValue): Promise<BlockListView> {
    return { items: await this.list.execute(profile) };
  }

  @Post()
  @HttpCode(204)
  @ApiNoContentResponse()
  async blockProfile(
    @Body() body: BlockProfileDto,
    @ActiveProfile() profile: ActiveProfileValue,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.block.execute({ active: profile, profileId: body.profileId, client });
  }

  @Delete(':profileId')
  @HttpCode(204)
  @ApiParam({ name: 'profileId', schema: { type: 'string', format: 'uuid' } })
  @ApiNoContentResponse()
  async unblockProfile(
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @ActiveProfile() profile: ActiveProfileValue,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.unblock.execute({ active: profile, profileId, client });
  }
}
