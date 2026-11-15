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
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  type ActiveProfile as ActiveProfileValue,
  CreateAccountProfile,
  DeleteAccountProfile,
  DisableProfilePin,
  GetOwnProfile,
  ListAccountProfiles,
  type ProfileDetails,
  REAUTH_PIN_MAX_AGE_MS,
  ResetProfilePin,
  type ResolvedSession,
  sessionRef,
  SetOwnPin,
  SetProfileChildMarker,
  UpdateOwnProfile,
  SetOwnEmail,
  ClearOwnEmail,
  VerifyProfileEmail,
  ReadChildNotice,
} from '../application/contract';
import { clearUnlockCookie, setUnlockCookie } from './cookies';
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
import { EmailDto, EmailTokenDto } from './dto/auth.dto';
import { SetChildMarkerDto } from './dto/link.dto';
import {
  CreateProfileDto,
  ResetProfilePinDto,
  SetOwnPinDto,
  UpdateProfileDto,
} from './dto/profile.dto';
import { AccountProfileListView, AccountProfileView, ProfileView } from './dto/profile.view';

function toView(profile: ProfileDetails): ProfileView {
  return {
    id: profile.id,
    displayName: profile.displayName,
    avatar: profile.avatar,
    accentColor: profile.accentColor,
    birthday:
      profile.birthdayDay !== null && profile.birthdayMonth !== null
        ? { day: profile.birthdayDay, month: profile.birthdayMonth, year: profile.birthdayYear }
        : null,
    locale: profile.locale,
    currency: profile.currency,
    timezone: profile.timezone,
    isChild: profile.isChild,
    hasPin: profile.hasPin,
    pinRelock: profile.pinRelock,
    pinResetNoticeAt: profile.pinResetNoticeAt?.toISOString() ?? null,
    email: profile.email,
    childNoticeAt: profile.childNoticeAt?.toISOString() ?? null,
    version: profile.version,
  };
}

/** API-17 : `If-Match: "3"` (ou `3`). Toute autre forme est refusée. */
function parseIfMatch(header: string | undefined): number {
  const match = /^(?:W\/)?"?([1-9][0-9]{0,9})"?$/.exec(header?.trim() ?? '');
  const version = match?.[1] ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(version)) throw new BadRequestException();
  return version;
}

/**
 * Profil actif (PRO-02, PRO-03, PIN-04) : `/profiles/me`, jamais `/profiles/{id}` (ADR 0013). Le
 * profil vient de la session, déverrouillé (API-11).
 */
@ApiTags('profiles')
@RequiresProfile()
@Controller('profiles/me')
export class ProfilesController {
  constructor(
    private readonly getUseCase: GetOwnProfile,
    private readonly updateUseCase: UpdateOwnProfile,
    private readonly setPinUseCase: SetOwnPin,
    private readonly setEmailUseCase: SetOwnEmail,
    private readonly clearEmailUseCase: ClearOwnEmail,
    private readonly childNoticeUseCase: ReadChildNotice,
  ) {}

  @Get()
  @ApiOkResponse({ type: ProfileView })
  async getOwnProfile(
    @ActiveProfile() profile: ActiveProfileValue,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProfileView> {
    const details = await this.getUseCase.execute(profile);
    response.setHeader('ETag', `"${details.version}"`);
    return toView(details);
  }

  /** PRO-03 : sans marqueur enfant. Version dépassée : `412`, le client relit le profil. */
  @Patch()
  @ApiHeader({ name: 'If-Match', required: true, description: 'Version lue (API-17).' })
  @ApiOkResponse({ type: ProfileView })
  async updateOwnProfile(
    @Body() body: UpdateProfileDto,
    @Headers('if-match') ifMatch: string | undefined,
    @ActiveProfile() profile: ActiveProfileValue,
    @ClientContext() client: ClientContextValue,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProfileView> {
    const details = await this.updateUseCase.execute({
      profile,
      expectedVersion: parseIfMatch(ifMatch),
      changes: {
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.birthday !== undefined
          ? {
              birthday: body.birthday
                ? {
                    day: body.birthday.day,
                    month: body.birthday.month,
                    year: body.birthday.year ?? null,
                  }
                : null,
            }
          : {}),
        ...(body.locale !== undefined ? { locale: body.locale } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.pinRelock !== undefined ? { pinRelock: body.pinRelock } : {}),
      },
      currentPin: body.currentPin ?? null,
      client,
    });
    response.setHeader('ETag', `"${details.version}"`);
    return toView(details);
  }

  /**
   * PIN-04 : créer son PIN, ou le changer avec l'ancien (compté par PIN-03), sans
   * ré-authentification. Jamais de désactivation ici.
   */
  @Put('pin')
  @HttpCode(204)
  @ApiNoContentResponse()
  async setOwnPin(
    @Body() body: SetOwnPinDto,
    @CurrentSession() current: ResolvedSession,
    @ActiveProfile() profile: ActiveProfileValue,
    @ClientContext() client: ClientContextValue,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const { unlockNonce } = await this.setPinUseCase.execute({
      session: sessionRef(current.record),
      profile,
      currentPin: body.currentPin ?? null,
      newPin: body.newPin,
      client,
    });
    if (unlockNonce) setUnlockCookie(response, unlockNonce);
    else clearUnlockCookie(response);
  }

  /**
   * PRO-10 : adresse du profil, écrite seulement à sa vérification par le lien envoyé. Refusée à
   * un profil enfant. Jamais un identifiant de connexion.
   */
  @Put('email')
  @HttpCode(204)
  @ApiNoContentResponse()
  async setOwnEmail(
    @Body() body: EmailDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.setEmailUseCase.execute({ profile, email: body.email });
  }

  @Delete('email')
  @HttpCode(204)
  @ApiNoContentResponse()
  async clearOwnEmail(@ActiveProfile() profile: ActiveProfileValue): Promise<void> {
    await this.clearEmailUseCase.execute(profile);
  }

  /** PRO-09 : le profil a lu la notice du changement de son marqueur enfant. */
  @Delete('child-notice')
  @HttpCode(204)
  @ApiNoContentResponse()
  async readChildNotice(@ActiveProfile() profile: ActiveProfileValue): Promise<void> {
    await this.childNoticeUseCase.execute(profile);
  }
}

/** PRO-10 : vérification de l'adresse d'un profil par son lien (publique, jeton dans le corps). */
@ApiTags('profiles')
@Controller('profiles/email/verify')
export class ProfileEmailVerificationController {
  constructor(private readonly verifyUseCase: VerifyProfileEmail) {}

  @Post()
  @Public()
  @HttpCode(204)
  @ApiNoContentResponse()
  async verifyProfileEmail(
    @Body() body: EmailTokenDto,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.verifyUseCase.execute({ token: body.token, client });
  }
}

/**
 * Profils dans l'espace Compte (PIN-08, PRO-08, PIN-05) : métadonnées seulement, forme figée par
 * un test. Supprimer exige une ré-authentification de moins de 10 minutes ; réinitialiser ou
 * désactiver un PIN, de moins de 2 minutes (AUTH-14, ADR 0013).
 */
@ApiTags('account')
@AccountScope()
@Controller('account/profiles')
export class AccountProfilesController {
  constructor(
    private readonly listUseCase: ListAccountProfiles,
    private readonly createUseCase: CreateAccountProfile,
    private readonly deleteUseCase: DeleteAccountProfile,
    private readonly resetPinUseCase: ResetProfilePin,
    private readonly disablePinUseCase: DisableProfilePin,
    private readonly childMarkerUseCase: SetProfileChildMarker,
  ) {}

  @Get()
  @ApiOkResponse({ type: AccountProfileListView })
  async listAccountProfiles(
    @CurrentSession() current: ResolvedSession,
  ): Promise<AccountProfileListView> {
    const profiles = await this.listUseCase.execute(current.record.accountId);
    return { items: profiles.map(toAccountProfileView) };
  }

  @Post()
  @ApiCreatedResponse({ type: AccountProfileView })
  async createAccountProfile(
    @Body() body: CreateProfileDto,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<AccountProfileView> {
    const profile = await this.createUseCase.execute({
      accountId: current.record.accountId,
      displayName: body.displayName,
      isChild: body.isChild ?? false,
      client,
    });
    return toAccountProfileView(profile);
  }

  /** `404` pour un profil inconnu comme pour celui d'un autre compte (SEC-04). */
  @Delete(':id')
  @RequiresRecentReauth()
  @HttpCode(204)
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiNoContentResponse()
  async deleteAccountProfile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.deleteUseCase.execute({
      session: sessionRef(current.record),
      profileId: id,
      client,
    });
  }

  /**
   * PRO-09 : marqueur « profil enfant », dans les deux sens, depuis l'espace Compte seulement et
   * après une ré-authentification de moins de 10 minutes (AUTH-14).
   */
  @Put(':id/child')
  @RequiresRecentReauth()
  @HttpCode(204)
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiNoContentResponse()
  async setChildMarker(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SetChildMarkerDto,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.childMarkerUseCase.execute({
      session: sessionRef(current.record),
      profileId: id,
      isChild: body.isChild,
      client,
    });
  }

  @Put(':id/pin/reset')
  @RequiresRecentReauth(REAUTH_PIN_MAX_AGE_MS)
  @HttpCode(204)
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiNoContentResponse()
  async resetProfilePin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ResetProfilePinDto,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.resetPinUseCase.execute({
      session: sessionRef(current.record),
      profileId: id,
      newPin: body.newPin,
      client,
    });
    if (current.record.activeProfileId === id) clearUnlockCookie(response);
  }

  @Delete(':id/pin')
  @RequiresRecentReauth(REAUTH_PIN_MAX_AGE_MS)
  @HttpCode(204)
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiNoContentResponse()
  async disableProfilePin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.disablePinUseCase.execute({
      session: sessionRef(current.record),
      profileId: id,
      client,
    });
  }
}

function toAccountProfileView(profile: {
  readonly id: string;
  readonly displayName: string;
  readonly avatar: string | null;
  readonly accentColor: string;
  readonly hasPin: boolean;
  readonly isChild: boolean;
  readonly hasEmail: boolean;
}): AccountProfileView {
  // Champ par champ : rien d'autre ne sort, même si le cas d'usage en renvoyait plus (PIN-08).
  return {
    id: profile.id,
    displayName: profile.displayName,
    avatar: profile.avatar,
    accentColor: profile.accentColor,
    hasPin: profile.hasPin,
    isChild: profile.isChild,
    hasEmail: profile.hasEmail,
  };
}
