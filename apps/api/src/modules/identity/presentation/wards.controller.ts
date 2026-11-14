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
  AttestAgeForRelease,
  CreateWard,
  CreateWardProfile,
  GetWard,
  ListWards,
  RequestWardRelease,
  ResetWardPassword,
  type ResolvedSession,
  RevokeWardSessions,
  SetupWardAccount,
  type WardSummary,
} from '../application/contract';
import {
  AccountScope,
  ClientContext,
  type ClientContextValue,
  CurrentSession,
  Public,
  RequiresRecentReauth,
} from './decorators';
import {
  AccountSetupDto,
  AgeAttestationDto,
  CreateWardDto,
  CreateWardProfileDto,
} from './dto/ward.dto';
import {
  CreatedWardProfileView,
  WardDetailView,
  WardListView,
  type WardView,
} from './dto/ward.view';

const WARD_ID = { name: 'id', schema: { type: 'string', format: 'uuid' } } as const;

/** Champs de `WardView`, en objet simple (étendu par `WardDetailView`). */
type WardFields = { readonly [K in keyof WardView]: WardView[K] };

/** Champ par champ : rien d'autre ne sort, même si le cas d'usage en renvoyait plus (PIN-08). */
function toWardView(ward: WardSummary): WardFields {
  return {
    id: ward.id,
    email: ward.email,
    createdAt: ward.createdAt.toISOString(),
    releaseRequested: ward.releaseRequested,
    profiles: ward.profiles.map((profile) => ({
      id: profile.id,
      displayName: profile.displayName,
      avatar: profile.avatar,
      accentColor: profile.accentColor,
      hasPin: profile.hasPin,
      isChild: profile.isChild,
      hasEmail: profile.hasEmail,
    })),
  };
}

/**
 * Comptes sous tutelle, depuis l'espace Compte du tuteur (PRO-15, PRO-16) : garde-fous seulement,
 * métadonnées seulement (PIN-08). Chaque route, lecture comprise, exige une ré-authentification de
 * moins de 10 minutes (AUTH-14). Un compte d'un autre tuteur répond `404` (SEC-04).
 */
@ApiTags('account')
@AccountScope()
@Controller('account/wards')
export class WardsController {
  constructor(
    private readonly createUseCase: CreateWard,
    private readonly listUseCase: ListWards,
    private readonly getUseCase: GetWard,
    private readonly revokeSessionsUseCase: RevokeWardSessions,
    private readonly resetPasswordUseCase: ResetWardPassword,
    private readonly createProfileUseCase: CreateWardProfile,
    private readonly releaseUseCase: RequestWardRelease,
  ) {}

  /** PRO-15 : la réponse est la même que l'adresse ait déjà un compte ou non (AUTH-09). */
  @Post()
  @RequiresRecentReauth()
  @HttpCode(204)
  @ApiNoContentResponse()
  async createWard(
    @Body() body: CreateWardDto,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.createUseCase.execute({
      guardianAccountId: current.record.accountId,
      email: body.email,
      profileName: body.profileName,
      guardianAttested: body.guardianAttested,
      client,
    });
  }

  @Get()
  @RequiresRecentReauth()
  @ApiOkResponse({ type: WardListView })
  async listWards(@CurrentSession() current: ResolvedSession): Promise<WardListView> {
    const wards = await this.listUseCase.execute(current.record.accountId);
    return { items: wards.map(toWardView) };
  }

  @Get(':id')
  @RequiresRecentReauth()
  @ApiParam(WARD_ID)
  @ApiOkResponse({ type: WardDetailView })
  async getWard(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentSession() current: ResolvedSession,
  ): Promise<WardDetailView> {
    const { ward, sessions } = await this.getUseCase.execute({
      guardianAccountId: current.record.accountId,
      wardAccountId: id,
    });
    return {
      ...toWardView(ward),
      sessions: sessions.map((session) => ({
        id: session.id,
        userAgent: session.userAgent,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
      })),
    };
  }

  @Delete(':id/sessions')
  @RequiresRecentReauth()
  @HttpCode(204)
  @ApiParam(WARD_ID)
  @ApiNoContentResponse()
  async revokeWardSessions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.revokeSessionsUseCase.execute({
      guardianAccountId: current.record.accountId,
      wardAccountId: id,
      client,
    });
  }

  /** PRO-16 : le lien de réinitialisation part à l'adresse du tuteur. */
  @Post(':id/password-reset')
  @RequiresRecentReauth()
  @HttpCode(204)
  @ApiParam(WARD_ID)
  @ApiNoContentResponse()
  async resetWardPassword(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.resetPasswordUseCase.execute({
      guardianAccountId: current.record.accountId,
      wardAccountId: id,
      client,
    });
  }

  @Post(':id/profiles')
  @RequiresRecentReauth()
  @ApiParam(WARD_ID)
  @ApiCreatedResponse({ type: CreatedWardProfileView })
  async createWardProfile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateWardProfileDto,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<CreatedWardProfileView> {
    return this.createProfileUseCase.execute({
      guardianAccountId: current.record.accountId,
      wardAccountId: id,
      displayName: body.displayName,
      client,
    });
  }

  /** PRO-16 : levée demandée ; elle prend effet à la déclaration d'âge du compte. */
  @Post(':id/release')
  @RequiresRecentReauth()
  @HttpCode(204)
  @ApiParam(WARD_ID)
  @ApiNoContentResponse()
  async requestWardRelease(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.releaseUseCase.execute({
      guardianAccountId: current.record.accountId,
      wardAccountId: id,
      client,
    });
  }
}

/** AUTH-08, PRO-16 : déclaration d'âge du compte sous tutelle, qui fait effet à la levée demandée. */
@ApiTags('account')
@AccountScope()
@Controller('account/age-attestation')
export class AgeAttestationController {
  constructor(private readonly attestUseCase: AttestAgeForRelease) {}

  @Post()
  @RequiresRecentReauth()
  @HttpCode(204)
  @ApiNoContentResponse()
  async attestAge(
    @Body() body: AgeAttestationDto,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.attestUseCase.execute({
      accountId: current.record.accountId,
      ageAttested: body.ageAttested,
      client,
    });
  }
}

/**
 * PRO-15 : installation d'un compte sous tutelle par son lien (publique, jeton dans le corps).
 * Aucune session n'est ouverte : on se connecte ensuite avec le mot de passe choisi.
 */
@ApiTags('auth')
@Controller('accounts/setup')
export class AccountSetupController {
  constructor(private readonly setupUseCase: SetupWardAccount) {}

  @Post()
  @Public()
  @HttpCode(204)
  @ApiNoContentResponse()
  async setupAccount(
    @Body() body: AccountSetupDto,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.setupUseCase.execute({
      token: body.token,
      password: body.password,
      ...(body.ageAttested ? { ageAttested: body.ageAttested } : {}),
      client,
    });
  }
}
