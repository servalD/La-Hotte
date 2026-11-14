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
  AcceptTransfer,
  type ActiveProfile as ActiveProfileValue,
  CancelTransferAsOrigin,
  CancelTransferByEmail,
  ConsentOwnTransfer,
  ConsentTransferByEmail,
  GetAccountProfileTransfer,
  GetOwnTransfer,
  InspectTransfer,
  ListIncomingTransfers,
  RefuseOwnTransfer,
  RequestTransfer,
  type ResolvedSession,
  type TransferState,
  WithdrawTransferAcceptance,
} from '../application/contract';
import {
  AccountScope,
  ActiveProfile,
  ClientContext,
  type ClientContextValue,
  CurrentSession,
  Public,
  RequiresProfile,
  RequiresRecentReauth,
} from './decorators';
import {
  RequestTransferDto,
  TransferCancelDto,
  TransferConsentByEmailDto,
  TransferConsentDto,
  TransferTokenDto,
} from './dto/transfer.dto';
import {
  CreatedTransferView,
  IncomingTransferListView,
  OwnTransferStateView,
  TransferPreviewView,
  TransferView,
} from './dto/transfer.view';

const ID = { name: 'id', schema: { type: 'string', format: 'uuid' } } as const;

type TransferFields = { readonly [K in keyof TransferView]: TransferView[K] };

/** Champ par champ (PIN-08) : ni jeton, ni hash, ni comptes. */
function toTransferView(transfer: TransferState): TransferFields {
  return {
    id: transfer.id,
    kind: transfer.kind,
    regroup: transfer.regroup,
    newEmail: transfer.newEmail,
    profileConsentRequired: transfer.profileConsentRequired,
    profileConsented: transfer.profileAcceptedAt !== null,
    destinationAccepted: transfer.toAcceptedAt !== null,
    pinChoice: transfer.pinChoice,
    executesAt: transfer.executesAt?.toISOString() ?? null,
    expiresAt: transfer.expiresAt.toISOString(),
  };
}

/**
 * PRO-12, PRO-13 : demande de passage ou de détachement depuis l'espace Compte d'origine. La
 * demande exige une ré-authentification de moins de 10 minutes (AUTH-14).
 */
@ApiTags('account')
@AccountScope()
@Controller('account/profiles')
export class AccountProfileTransferController {
  constructor(
    private readonly requestUseCase: RequestTransfer,
    private readonly getUseCase: GetAccountProfileTransfer,
    private readonly cancelUseCase: CancelTransferAsOrigin,
  ) {}

  @Post(':id/transfer')
  @RequiresRecentReauth()
  @ApiParam(ID)
  @ApiCreatedResponse({ type: CreatedTransferView })
  async requestTransfer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RequestTransferDto,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<CreatedTransferView> {
    const created = await this.requestUseCase.execute({
      accountId: current.record.accountId,
      profileId: id,
      kind: body.kind,
      regroup: body.regroup ?? false,
      ...(body.email ? { email: body.email } : {}),
      ...(body.pinChoice ? { pinChoice: body.pinChoice } : {}),
      ...(body.newPin !== undefined ? { newPin: body.newPin } : {}),
      client,
    });
    return {
      transferId: created.transferId,
      token: created.token,
      expiresAt: created.expiresAt.toISOString(),
    };
  }

  @Get(':id/transfer')
  @ApiParam(ID)
  @ApiOkResponse({ type: TransferView })
  async getAccountProfileTransfer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentSession() current: ResolvedSession,
  ): Promise<TransferView> {
    const transfer = await this.getUseCase.execute({
      accountId: current.record.accountId,
      profileId: id,
    });
    // Revue SEC-40 (cycle 2, I1) : l'adresse du détachement peut être celle du profil, que
    // l'espace Compte ne lit jamais (PRO-10, PIN-08) ; seul le profil la voit.
    return { ...toTransferView(transfer), newEmail: null };
  }

  @Delete(':id/transfer')
  @HttpCode(204)
  @ApiParam(ID)
  @ApiNoContentResponse()
  async cancelAccountProfileTransfer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.cancelUseCase.execute({
      accountId: current.record.accountId,
      profileId: id,
      client,
    });
  }
}

/** PRO-12 : compte d'arrivée. Accepter exige une ré-authentification de moins de 10 minutes. */
@ApiTags('account')
@AccountScope()
@Controller('account/transfers')
export class IncomingTransfersController {
  constructor(
    private readonly inspectUseCase: InspectTransfer,
    private readonly acceptUseCase: AcceptTransfer,
    private readonly listUseCase: ListIncomingTransfers,
    private readonly withdrawUseCase: WithdrawTransferAcceptance,
  ) {}

  /** Le jeton dans le corps, jamais dans l'adresse (journaux, historique). */
  @Post('inspect')
  @HttpCode(200)
  @ApiOkResponse({ type: TransferPreviewView })
  async inspectTransfer(
    @Body() body: TransferTokenDto,
    @CurrentSession() current: ResolvedSession,
  ): Promise<TransferPreviewView> {
    const preview = await this.inspectUseCase.execute({
      accountId: current.record.accountId,
      token: body.token,
    });
    return {
      transferId: preview.transferId,
      profileName: preview.profileName,
      avatar: preview.avatar,
      accentColor: preview.accentColor,
      isChild: preview.isChild,
    };
  }

  @Post('accept')
  @RequiresRecentReauth()
  @HttpCode(204)
  @ApiNoContentResponse()
  async acceptTransfer(
    @Body() body: TransferTokenDto,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.acceptUseCase.execute({
      accountId: current.record.accountId,
      token: body.token,
      client,
    });
  }

  @Get()
  @ApiOkResponse({ type: IncomingTransferListView })
  async listIncomingTransfers(
    @CurrentSession() current: ResolvedSession,
  ): Promise<IncomingTransferListView> {
    const items = await this.listUseCase.execute(current.record.accountId);
    return {
      items: items.map((item) => ({
        id: item.id,
        profileName: item.profileName,
        accentColor: item.accentColor,
        executesAt: item.executesAt?.toISOString() ?? null,
      })),
    };
  }

  @Delete(':id/acceptance')
  @HttpCode(204)
  @ApiParam(ID)
  @ApiNoContentResponse()
  async withdrawTransferAcceptance(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.withdrawUseCase.execute({
      accountId: current.record.accountId,
      transferId: id,
      client,
    });
  }
}

/** PRO-12 : la demande qui concerne le profil actif (PIN validé) : la voir, l'accepter, la refuser. */
@ApiTags('profiles')
@RequiresProfile()
@Controller('profiles/me/transfer')
export class OwnTransferController {
  constructor(
    private readonly getUseCase: GetOwnTransfer,
    private readonly consentUseCase: ConsentOwnTransfer,
    private readonly refuseUseCase: RefuseOwnTransfer,
  ) {}

  @Get()
  @ApiOkResponse({ type: OwnTransferStateView })
  async getOwnTransfer(
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<OwnTransferStateView> {
    const own = await this.getUseCase.execute(profile);
    return {
      transfer: own
        ? { ...toTransferView(own.transfer), destinationNames: [...own.destinationNames] }
        : null,
    };
  }

  @Post('consent')
  @HttpCode(204)
  @ApiNoContentResponse()
  async consentOwnTransfer(
    @Body() body: TransferConsentDto,
    @ActiveProfile() profile: ActiveProfileValue,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.consentUseCase.execute({
      active: profile,
      pinChoice: body.pinChoice,
      ...(body.newPin !== undefined ? { newPin: body.newPin } : {}),
      client,
    });
  }

  @Delete()
  @HttpCode(204)
  @ApiNoContentResponse()
  async refuseOwnTransfer(
    @ActiveProfile() profile: ActiveProfileValue,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.refuseUseCase.execute({ active: profile, client });
  }
}

/** PRO-12 : liens envoyés à l'adresse du profil (publics, jeton dans le corps, ADR 0013). */
@ApiTags('profiles')
@Controller('transfers')
export class TransferLinksController {
  constructor(
    private readonly consentUseCase: ConsentTransferByEmail,
    private readonly cancelUseCase: CancelTransferByEmail,
  ) {}

  @Post('consent')
  @Public()
  @HttpCode(204)
  @ApiNoContentResponse()
  async consentTransferByEmail(
    @Body() body: TransferConsentByEmailDto,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.consentUseCase.execute({
      token: body.token,
      pinChoice: body.pinChoice,
      ...(body.newPin !== undefined ? { newPin: body.newPin } : {}),
      client,
    });
  }

  @Post('cancel')
  @Public()
  @HttpCode(204)
  @ApiNoContentResponse()
  async cancelTransferByEmail(
    @Body() body: TransferCancelDto,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.cancelUseCase.execute({ token: body.token, client });
  }
}
