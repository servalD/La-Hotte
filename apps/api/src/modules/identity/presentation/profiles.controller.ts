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
  UpdateOwnProfile,
} from '../application/contract';
import { clearUnlockCookie, setUnlockCookie } from './cookies';
import {
  AccountScope,
  ActiveProfile,
  ClientContext,
  type ClientContextValue,
  CurrentSession,
  RequiresProfile,
  RequiresRecentReauth,
} from './decorators';
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
}): AccountProfileView {
  // Champ par champ : rien d'autre ne sort, même si le cas d'usage en renvoyait plus (PIN-08).
  return {
    id: profile.id,
    displayName: profile.displayName,
    avatar: profile.avatar,
    accentColor: profile.accentColor,
    hasPin: profile.hasPin,
    isChild: profile.isChild,
  };
}
