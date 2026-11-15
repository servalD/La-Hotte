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
import { ApiNoContentResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  AcceptProfileInvitation,
  DecideProfileProposal,
  InspectProfileInvitation,
  ListProfileProposals,
  type ResolvedSession,
} from '../application/contract';
import {
  AccountScope,
  ClientContext,
  type ClientContextValue,
  CurrentSession,
  Public,
  RequiresRecentReauth,
} from './decorators';
import { AcceptProfileInvitationDto, InvitationTokenDto } from './dto/link.dto';
import { ProfileInvitationPreviewView, ProfileProposalListView } from './dto/link.view';

const PROPOSAL_ID = { name: 'id', schema: { type: 'string', format: 'uuid' } } as const;

/**
 * PRO-11 : propositions de profil reçues par l'espace Compte. Accepter exige une
 * ré-authentification de moins de 10 minutes (AUTH-14) ; refuser, non.
 */
@ApiTags('account')
@AccountScope()
@Controller('account/profile-proposals')
export class ProfileProposalsController {
  constructor(
    private readonly listUseCase: ListProfileProposals,
    private readonly decideUseCase: DecideProfileProposal,
  ) {}

  @Get()
  @ApiOkResponse({ type: ProfileProposalListView })
  async listProfileProposals(
    @CurrentSession() current: ResolvedSession,
  ): Promise<ProfileProposalListView> {
    const proposals = await this.listUseCase.execute(current.record.accountId);
    return {
      items: proposals.map((proposal) => ({
        id: proposal.id,
        inviterName: proposal.inviterName,
        profileIsChild: proposal.profileIsChild,
        expiresAt: proposal.expiresAt.toISOString(),
      })),
    };
  }

  @Post(':id/accept')
  @RequiresRecentReauth()
  @HttpCode(204)
  @ApiParam(PROPOSAL_ID)
  @ApiNoContentResponse()
  async acceptProfileProposal(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.decideUseCase.execute({
      accountId: current.record.accountId,
      invitationId: id,
      accept: true,
      client,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiParam(PROPOSAL_ID)
  @ApiNoContentResponse()
  async refuseProfileProposal(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.decideUseCase.execute({
      accountId: current.record.accountId,
      invitationId: id,
      accept: false,
      client,
    });
  }
}

/**
 * PRO-11 : ouverture d'une invitation à créer un profil, sans session (jeton dans le corps, ADR
 * 0013). Aucune session n'est ouverte : l'accès suit par les identifiants du compte.
 */
@ApiTags('invitations')
@Controller('invitations/profile')
export class ProfileInvitationsController {
  constructor(
    private readonly inspectUseCase: InspectProfileInvitation,
    private readonly acceptUseCase: AcceptProfileInvitation,
  ) {}

  @Post('inspect')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: ProfileInvitationPreviewView })
  async inspectProfileInvitation(
    @Body() body: InvitationTokenDto,
    @ClientContext() client: ClientContextValue,
  ): Promise<ProfileInvitationPreviewView> {
    const preview = await this.inspectUseCase.execute({ token: body.token, client });
    return {
      inviterName: preview.inviterName,
      profileIsChild: preview.profileIsChild,
      expiresAt: preview.expiresAt.toISOString(),
    };
  }

  @Post('accept')
  @Public()
  @HttpCode(204)
  @ApiNoContentResponse()
  async acceptProfileInvitation(
    @Body() body: AcceptProfileInvitationDto,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.acceptUseCase.execute({
      token: body.token,
      displayName: body.displayName,
      ...(body.pin !== undefined ? { pin: body.pin } : {}),
      ...(body.email ? { email: body.email } : {}),
      client,
    });
  }
}
