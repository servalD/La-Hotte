import { Body, Controller, Delete, Get, HttpCode, Post, Redirect, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AppConfig } from '../../../platform/config/env';
import { DomainError } from '../../../shared/domain';
import {
  AuthorizeProfile,
  CompleteGoogleFlow,
  CsrfTokens,
  type GoogleOutcome,
  type IssuedSession,
  PENDING_SECOND_FACTOR_TTL_MS,
  type ResolvedSession,
  sessionRef,
  StartGoogleFlow,
  UnlinkGoogle,
} from '../application/contract';
import {
  clearPendingCookie,
  clearPresessionCookie,
  DEVICE_COOKIE,
  PRESESSION_COOKIE,
  readCookie,
  setPendingCookie,
  setPresessionCookie,
  setSessionCookies,
  UNLOCK_COOKIE,
} from './cookies';
import {
  AccountScope,
  ClientContext,
  type ClientContextValue,
  CurrentSession,
  OidcCallback,
  Public,
  RequiresRecentReauth,
} from './decorators';
import { GoogleStartDto } from './dto/auth.dto';
import { GoogleRedirectView } from './dto/google.view';
import { SessionStatusView } from './dto/session-status.view';

/**
 * Page du web qui reçoit l'issue d'un retour de Google (tranche 7) : `?status=<issue>` ou
 * `?error=<code stable>`. Jamais de jeton ni de valeur venue de Google dans cette adresse.
 */
export const GOOGLE_RETURN_PATH = '/auth/google/return';

/**
 * Connexion avec Google (AUTH-01, AUTH-03, AUTH-12, AUTH-14 ; ADR 0013, « Retour OIDC »).
 * Contrôleur mince : décision dans les cas d'usage, cookies et redirection ici.
 */
@ApiTags('auth')
@Controller('auth/google')
export class GoogleController {
  private readonly webOrigin: string;

  constructor(
    private readonly start: StartGoogleFlow,
    private readonly complete: CompleteGoogleFlow,
    private readonly unlink: UnlinkGoogle,
    private readonly authorizeProfile: AuthorizeProfile,
    private readonly csrf: CsrfTokens,
    config: AppConfig,
  ) {
    this.webOrigin = config.env.WEB_ORIGIN.replace(/\/+$/, '');
  }

  /**
   * Connexion, ou inscription si `registration` est fourni (AUTH-03, AUTH-08). Avant session :
   * jeton CSRF de pré-session ; le parcours est lié à cette pré-session.
   */
  @Post('start')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: GoogleRedirectView })
  async startGoogleSignIn(
    @Body() body: GoogleStartDto,
    @ClientContext() client: ClientContextValue,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<GoogleRedirectView> {
    const registration = body.registration
      ? {
          displayName: body.registration.displayName,
          locale: body.registration.locale ?? null,
          timezone: body.registration.timezone ?? null,
          invitationToken: body.registration.invitationToken ?? null,
        }
      : null;
    const started = await this.start.execute({
      kind: 'login',
      presessionId: readCookie(request, PRESESSION_COOKIE),
      registration,
      client,
    });
    if (started.newPresessionId) setPresessionCookie(response, started.newPresessionId);
    return { authorizationUrl: started.authorizationUrl };
  }

  /** AUTH-03, AUTH-14, AUTH-15 : association, après ré-authentification, compte vérifié. */
  @Post('link')
  @AccountScope()
  @RequiresRecentReauth()
  @HttpCode(200)
  @ApiOkResponse({ type: GoogleRedirectView })
  async startGoogleLink(
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<GoogleRedirectView> {
    const started = await this.start.execute({
      kind: 'link',
      session: sessionRef(current.record),
      client,
    });
    return { authorizationUrl: started.authorizationUrl };
  }

  /** AUTH-14 : ré-authentification par le compte Google associé, authentification fraîche. */
  @Post('reauth')
  @AccountScope()
  @HttpCode(200)
  @ApiOkResponse({ type: GoogleRedirectView })
  async startGoogleReauth(
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<GoogleRedirectView> {
    const started = await this.start.execute({
      kind: 'reauth',
      session: sessionRef(current.record),
      client,
    });
    return { authorizationUrl: started.authorizationUrl };
  }

  /**
   * Retour de Google : seul `GET` qui modifie l'état (API-21). Pas de jeton CSRF possible (navigation
   * venue de Google) : le parcours est lié à la pré-session ou à la session qui l'a démarré, et
   * `state` ne sert qu'une fois. Réponse : redirection vers la page de retour du web, jamais un
   * contenu ; ni cache ni `Referer` (la chaîne de requête porte `code` et `state`).
   */
  @Get('callback')
  @Public()
  @OidcCallback()
  @Redirect(undefined, 303)
  @ApiExcludeEndpoint()
  async googleCallback(
    @CurrentSession() current: ResolvedSession | null,
    @ClientContext() client: ClientContextValue,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ url: string }> {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const index = request.originalUrl.indexOf('?');
    const callbackQuery = index < 0 ? '' : request.originalUrl.slice(index + 1);
    let outcome: GoogleOutcome;
    try {
      outcome = await this.complete.execute({
        callbackQuery,
        presessionId: readCookie(request, PRESESSION_COOKIE),
        session: current ? sessionRef(current.record) : null,
        reauthAt: current?.record.reauthAt ?? null,
        deviceToken: readCookie(request, DEVICE_COOKIE),
        client,
      });
    } catch (error) {
      // Erreur métier : le code stable va à la page de retour. Toute autre erreur suit le
      // chemin ordinaire (500, rapport d'erreur nettoyé).
      if (error instanceof DomainError) return this.returnTo('error', error.code);
      throw error;
    }
    switch (outcome.kind) {
      case 'signed_in':
        clearPresessionCookie(response);
        clearPendingCookie(response);
        this.setSession(outcome.issued, response);
        break;
      case 'second_factor':
        setPendingCookie(response, outcome.pendingToken, PENDING_SECOND_FACTOR_TTL_MS);
        break;
      case 'reauthenticated':
        this.setSession(outcome.issued, response);
        break;
      case 'linked':
      case 'reauth_second_factor':
        break;
    }
    return this.returnTo('status', outcome.kind);
  }

  /**
   * AUTH-03, AUTH-05, AUTH-14 : dissociation, seulement avec un mot de passe. Toutes les autres
   * sessions tombent ; celle-ci est remplacée.
   */
  @Delete()
  @AccountScope()
  @RequiresRecentReauth()
  @HttpCode(200)
  @ApiOkResponse({ type: SessionStatusView })
  async unlinkGoogle(
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionStatusView> {
    const issued = await this.unlink.execute({ session: sessionRef(current.record), client });
    const csrfToken = this.setSession(issued, response);
    const profile = await this.authorizeProfile.describe({
      session: { record: issued.record, unlock: null },
      unlockCookie: readCookie(request, UNLOCK_COOKIE),
    });
    return {
      authenticated: true,
      csrfToken,
      session: {
        id: issued.record.id,
        activeProfileId: profile.profileId,
        profileUnlocked: profile.unlocked,
        expiresAt: issued.record.expiresAt.toISOString(),
      },
      secondFactorPending: false,
    };
  }

  /** Cookies d'une session ouverte ou tournée ; renvoie le nouveau jeton CSRF. */
  private setSession(issued: IssuedSession, response: Response): string {
    const csrfToken = this.csrf.forSession(issued.record.tokenHash);
    setSessionCookies(response, {
      token: issued.token,
      csrfToken,
      expiresAt: issued.record.expiresAt,
    });
    return csrfToken;
  }

  private returnTo(key: 'status' | 'error', value: string): { url: string } {
    const url = new URL(GOOGLE_RETURN_PATH, this.webOrigin);
    url.searchParams.set(key, value);
    return { url: url.href };
  }
}
