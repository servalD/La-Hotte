import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  AuthorizeProfile,
  CsrfTokens,
  type ResolvedSession,
  SecretTokens,
} from '../application/contract';
import {
  clearSessionCookies,
  PRESESSION_COOKIE,
  readCookie,
  SESSION_COOKIE,
  setCsrfCookie,
  setPresessionCookies,
  UNLOCK_COOKIE,
} from './cookies';
import { CurrentSession, Public } from './decorators';
import { SessionStatusView } from './dto/session-status.view';

@ApiTags('session')
@Controller('session')
export class SessionController {
  constructor(
    private readonly authorizeProfile: AuthorizeProfile,
    private readonly csrf: CsrfTokens,
    private readonly tokens: SecretTokens,
  ) {}

  /**
   * État de la session et jeton CSRF (API-21, ADR 0013). Public : avant session, il pose la
   * pré-session (CSRF de connexion). Ne prolonge jamais le déverrouillage du profil.
   */
  @Get()
  @Public()
  @ApiOkResponse({ type: SessionStatusView })
  async getSession(
    @CurrentSession() session: ResolvedSession | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionStatusView> {
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
      };
    }

    // Cookie de session présent mais refusé (expiré, révoqué) : retiré du navigateur.
    if (readCookie(request, SESSION_COOKIE) !== null) clearSessionCookies(response);
    const current = readCookie(request, PRESESSION_COOKIE);
    const presessionId =
      current && this.tokens.isWellFormed(current) ? current : this.tokens.generate();
    const csrfToken = this.csrf.forPresession(presessionId);
    setPresessionCookies(response, { presessionId, csrfToken });
    return { authenticated: false, csrfToken, session: null };
  }
}
