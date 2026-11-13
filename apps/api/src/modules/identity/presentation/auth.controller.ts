import { Body, Controller, HttpCode, Post, Put, Req, Res } from '@nestjs/common';
import { ApiAcceptedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  AuthorizeProfile,
  CancelEmailChange,
  ChangePassword,
  ConfirmPasswordReset,
  CsrfTokens,
  type IssuedSession,
  Reauthenticate,
  RegisterAccount,
  RequestEmailChange,
  RequestPasswordReset,
  type ResolvedSession,
  sessionRef,
  SignInWithPassword,
  SignOut,
  VerifyEmail,
} from '../application/contract';
import {
  clearPresessionCookie,
  clearSessionCookies,
  readCookie,
  setSessionCookies,
  UNLOCK_COOKIE,
} from './cookies';
import {
  AccountScope,
  ClientContext,
  type ClientContextValue,
  CurrentSession,
  Public,
  RequiresRecentReauth,
} from './decorators';
import {
  EmailDto,
  EmailTokenDto,
  LoginDto,
  NewPasswordDto,
  PasswordResetConfirmDto,
  ReauthDto,
  RegisterDto,
} from './dto/auth.dto';
import { SessionStatusView } from './dto/session-status.view';

/**
 * Authentification par e-mail et mot de passe (`01`, ADR 0013). Contrôleur mince : validation par
 * les DTO, décision dans les cas d'usage, cookies ici. Les routes publiques sont celles d'avant
 * session (jeton CSRF de pré-session) ; les autres relèvent de l'espace Compte (PIN-08).
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly register: RegisterAccount,
    private readonly signInWithPassword: SignInWithPassword,
    private readonly signOutUseCase: SignOut,
    private readonly reauth: Reauthenticate,
    private readonly verify: VerifyEmail,
    private readonly cancelChange: CancelEmailChange,
    private readonly requestReset: RequestPasswordReset,
    private readonly confirmReset: ConfirmPasswordReset,
    private readonly changePasswordUseCase: ChangePassword,
    private readonly requestChange: RequestEmailChange,
    private readonly authorizeProfile: AuthorizeProfile,
    private readonly csrf: CsrfTokens,
  ) {}

  /**
   * AUTH-01, AUTH-09 : même réponse (`202`), même délai, que l'adresse ait déjà un compte ou non.
   * Aucune session n'est ouverte ; le lien de vérification part par e-mail.
   */
  @Post('register')
  @Public()
  @HttpCode(202)
  @ApiAcceptedResponse({ description: 'Demande reçue ; la suite arrive par e-mail.' })
  async registerAccount(
    @Body() body: RegisterDto,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.register.execute({
      email: body.email,
      password: body.password,
      displayName: body.displayName,
      ageAttested: body.ageAttested,
      ...(body.locale ? { locale: body.locale } : {}),
      ...(body.timezone ? { timezone: body.timezone } : {}),
      client,
    });
  }

  /** Connexion (AUTH-07) : nouvelle session, ancienne session du navigateur révoquée. */
  @Post('login')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: SessionStatusView })
  async signIn(
    @Body() body: LoginDto,
    @CurrentSession() current: ResolvedSession | null,
    @ClientContext() client: ClientContextValue,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionStatusView> {
    const issued = await this.signInWithPassword.execute({
      email: body.email,
      password: body.password,
      client,
      previous: current ? sessionRef(current.record) : null,
    });
    clearPresessionCookie(response);
    return this.open(issued, request, response);
  }

  /** Déconnexion : session courante révoquée, cookies retirés. */
  @Post('logout')
  @AccountScope()
  @HttpCode(204)
  @ApiNoContentResponse()
  async signOut(
    @CurrentSession() current: ResolvedSession,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.signOutUseCase.execute(sessionRef(current.record));
    clearSessionCookies(response);
  }

  /** AUTH-14 : même session, nouveau jeton, `reauth_at` posé ; jeton CSRF renouvelé. */
  @Post('reauth')
  @AccountScope()
  @HttpCode(200)
  @ApiOkResponse({ type: SessionStatusView })
  async reauthenticate(
    @Body() body: ReauthDto,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionStatusView> {
    const issued = await this.reauth.execute({
      session: sessionRef(current.record),
      password: body.password,
      client,
    });
    return this.open(issued, request, response);
  }

  /**
   * Lien de vérification (AUTH-15) ou de confirmation d'un changement d'adresse (AUTH-16). N'ouvre
   * jamais de session : on se connecte ensuite avec son mot de passe.
   */
  @Post('email/verify')
  @Public()
  @HttpCode(204)
  @ApiNoContentResponse()
  async verifyEmail(
    @Body() body: EmailTokenDto,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.verify.execute({ token: body.token, client });
  }

  /** AUTH-16 : annulation depuis l'ancienne adresse ; toutes les sessions sont révoquées. */
  @Post('email/cancel')
  @Public()
  @HttpCode(204)
  @ApiNoContentResponse()
  async cancelEmailChange(
    @Body() body: EmailTokenDto,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.cancelChange.execute({ token: body.token, client });
  }

  /** AUTH-06 : même réponse que l'adresse ait un compte ou non. */
  @Post('password/reset')
  @Public()
  @HttpCode(202)
  @ApiAcceptedResponse({ description: 'Demande reçue ; la suite arrive par e-mail.' })
  async requestPasswordReset(
    @Body() body: EmailDto,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.requestReset.execute({ email: body.email, client });
  }

  /** AUTH-06 : toutes les sessions, pré-authentifications et appareils de confiance révoqués. */
  @Post('password/reset/confirm')
  @Public()
  @HttpCode(204)
  @ApiNoContentResponse()
  async confirmPasswordReset(
    @Body() body: PasswordResetConfirmDto,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.confirmReset.execute({ token: body.token, newPassword: body.newPassword, client });
  }

  /** AUTH-05, AUTH-14 : toutes les autres sessions tombent ; celle-ci est remplacée. */
  @Put('password')
  @AccountScope()
  @RequiresRecentReauth()
  @HttpCode(200)
  @ApiOkResponse({ type: SessionStatusView })
  async changePassword(
    @Body() body: NewPasswordDto,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionStatusView> {
    const issued = await this.changePasswordUseCase.execute({
      session: sessionRef(current.record),
      newPassword: body.newPassword,
      client,
    });
    return this.open(issued, request, response);
  }

  /** AUTH-16, AUTH-14 : même réponse que la nouvelle adresse soit libre ou prise. */
  @Put('email')
  @AccountScope()
  @RequiresRecentReauth()
  @HttpCode(202)
  @ApiAcceptedResponse({ description: 'Demande reçue ; la suite arrive par e-mail.' })
  async requestEmailChange(
    @Body() body: EmailDto,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.requestChange.execute({
      accountId: current.record.accountId,
      newEmail: body.email,
      client,
    });
  }

  /** Cookies d'une session ouverte ou tournée, et état renvoyé au client. */
  private async open(
    issued: IssuedSession,
    request: Request,
    response: Response,
  ): Promise<SessionStatusView> {
    const csrfToken = this.csrf.forSession(issued.record.tokenHash);
    setSessionCookies(response, {
      token: issued.token,
      csrfToken,
      expiresAt: issued.record.expiresAt,
    });
    // Une session neuve ou tournée n'a pas de déverrouillage (ADR 0013).
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
    };
  }
}
