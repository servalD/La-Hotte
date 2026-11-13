import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  AuthorizeProfile,
  CsrfTokens,
  LockSession,
  type ResolvedSession,
  SecretTokens,
  SelectProfile,
  sessionRef,
  VerifySecondFactor,
} from '../application/contract';
import {
  clearPendingCookie,
  clearSessionCookies,
  clearUnlockCookie,
  PENDING_COOKIE,
  PRESESSION_COOKIE,
  readCookie,
  SESSION_COOKIE,
  setCsrfCookie,
  setPresessionCookies,
  setUnlockCookie,
  UNLOCK_COOKIE,
} from './cookies';
import {
  AccountScope,
  ClientContext,
  type ClientContextValue,
  CurrentSession,
  Public,
} from './decorators';
import { SelectProfileDto } from './dto/profile.dto';
import { ProfileSelectionView } from './dto/profile.view';
import { SessionStatusView } from './dto/session-status.view';

@ApiTags('session')
@Controller('session')
export class SessionController {
  constructor(
    private readonly authorizeProfile: AuthorizeProfile,
    private readonly secondFactor: VerifySecondFactor,
    private readonly csrf: CsrfTokens,
    private readonly tokens: SecretTokens,
    private readonly selectProfileUseCase: SelectProfile,
    private readonly lockSessionUseCase: LockSession,
  ) {}

  /**
   * État de la session et jeton CSRF (API-21, ADR 0013). Public : avant session, il pose la
   * pré-session (CSRF de connexion). Dit aussi si un second facteur est attendu (AUTH-12). Ne
   * prolonge jamais le déverrouillage du profil.
   */
  @Get()
  @Public()
  @ApiOkResponse({ type: SessionStatusView })
  async getSession(
    @CurrentSession() session: ResolvedSession | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionStatusView> {
    const pendingCookie = readCookie(request, PENDING_COOKIE);
    const secondFactorPending = await this.secondFactor.isPending(pendingCookie);
    // Pré-authentification expirée ou invalidée : cookie retiré du navigateur.
    if (pendingCookie !== null && !secondFactorPending) clearPendingCookie(response);

    if (session) {
      const csrfToken = this.csrf.forSession(session.record.tokenHash);
      setCsrfCookie(response, csrfToken);
      const profile = await this.authorizeProfile.describe({
        session,
        unlockCookie: readCookie(request, UNLOCK_COOKIE),
      });
      return {
        authenticated: true,
        csrfToken,
        session: {
          id: session.record.id,
          activeProfileId: profile.profileId,
          profileUnlocked: profile.unlocked,
          expiresAt: session.record.expiresAt.toISOString(),
        },
        secondFactorPending,
      };
    }

    // Cookie de session présent mais refusé (expiré, révoqué) : retiré du navigateur.
    if (readCookie(request, SESSION_COOKIE) !== null) clearSessionCookies(response);
    const current = readCookie(request, PRESESSION_COOKIE);
    const presessionId =
      current && this.tokens.isWellFormed(current) ? current : this.tokens.generate();
    const csrfToken = this.csrf.forPresession(presessionId);
    setPresessionCookies(response, { presessionId, csrfToken });
    return { authenticated: false, csrfToken, session: null, secondFactorPending };
  }

  /**
   * PRO-07, API-11 : choisit le profil actif, et le déverrouille avec son PIN s'il en a un. Le
   * changement a lieu avant la vérification : un PIN faux (`422 PIN_INVALID`) laisse le nouveau
   * profil actif et verrouillé. Pendant l'attente de PIN-03 : `429`.
   */
  @Post('profile')
  @AccountScope()
  @HttpCode(200)
  @ApiOkResponse({ type: ProfileSelectionView })
  async selectProfile(
    @Body() body: SelectProfileDto,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProfileSelectionView> {
    // Toute sélection efface le déverrouillage précédent : son cookie avec lui.
    clearUnlockCookie(response);
    const selection = await this.selectProfileUseCase.execute({
      session: sessionRef(current.record),
      profileId: body.profileId,
      pin: body.pin ?? null,
      client,
    });
    if (selection.unlockNonce) setUnlockCookie(response, selection.unlockNonce);
    return {
      activeProfileId: selection.profileId,
      profileUnlocked: selection.unlocked,
      pinResetNoticeAt: selection.pinResetNoticeAt?.toISOString() ?? null,
      failedPinAttempts: selection.failedPinAttempts,
    };
  }

  /** PIN-07 : verrouille le profil actif sans le changer ; efface la ré-authentification. */
  @Post('lock')
  @AccountScope()
  @HttpCode(204)
  @ApiNoContentResponse()
  async lockSession(
    @CurrentSession() current: ResolvedSession,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.lockSessionUseCase.execute(
      sessionRef(current.record),
      current.record.activeProfileId,
    );
    clearUnlockCookie(response);
  }
}
