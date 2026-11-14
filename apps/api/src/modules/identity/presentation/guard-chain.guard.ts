import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppConfig } from '../../../platform/config/env';
import { Clock } from '../../../shared/domain';
import {
  AuthorizeProfile,
  CsrfRejectedError,
  CsrfTokens,
  hasRecentReauth,
  ReauthRequiredError,
  ReportCsrfRejection,
  type ResolvedSession,
  ResolveSession,
  SessionRequiredError,
} from '../application/contract';
import { PRESESSION_COOKIE, readCookie, SESSION_COOKIE, UNLOCK_COOKIE } from './cookies';
import {
  ACCESS_MARK,
  type AccessMark,
  attachIdentity,
  clientContextOf,
  OIDC_CALLBACK_MARK,
  REAUTH_MARK,
} from './decorators';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-csrf-token';
export const USER_ACTIVITY_HEADER = 'x-user-activity';

/**
 * Chaîne de gardes globale (ADR 0013), dans cet ordre, refus par défaut (SEC-01) :
 * `SessionGuard` → `CsrfGuard` → `ProfileGuard` → `ReauthGuard`. Une seule garde Nest exécute
 * les quatre étapes : l'ordre ne dépend pas de l'ordre d'enregistrement des modules.
 */
@Injectable()
export class IdentityGuardChain implements CanActivate {
  private readonly webOrigin: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly resolveSession: ResolveSession,
    private readonly authorizeProfile: AuthorizeProfile,
    private readonly csrf: CsrfTokens,
    private readonly reportCsrfRejection: ReportCsrfRejection,
    private readonly clock: Clock,
    config: AppConfig,
  ) {
    this.webOrigin = config.env.WEB_ORIGIN;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Autre transport (WebSocket, phase 4) : sa propre garde, jamais celle-ci par défaut.
    if (context.getType() !== 'http') return false;
    const request = context.switchToHttp().getRequest<Request>();
    const targets = [context.getHandler(), context.getClass()];
    const mark = this.reflector.getAllAndOverride<AccessMark | undefined>(ACCESS_MARK, targets);
    // Route sans marque : erreur de programmation, refusée (le test des marques l'attrape avant).
    if (!mark) throw new Error('Route sans marque d’accès');

    // 1. Session.
    const session = await this.resolveSession.execute(readCookie(request, SESSION_COOKIE));
    attachIdentity(request, { session, profile: null });
    if (!session && mark !== 'public') throw new SessionRequiredError();
    // ADR 0013 : une réponse faite à une session n'est jamais mise en cache. Le cookie est le même
    // pour tous les profils d'un compte : un cache HTTP ne les distinguerait pas.
    if (mark !== 'public') {
      context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'no-store');
    }

    // 2. CSRF, sur toute méthode qui n'est pas sûre.
    const oidcCallback = this.reflector.get<boolean | undefined>(
      OIDC_CALLBACK_MARK,
      context.getHandler(),
    );
    if (!SAFE_METHODS.has(request.method) && !oidcCallback) {
      await this.checkCsrf(request, session, mark === 'public');
    }

    // 3. Profil actif déverrouillé.
    let profile = null;
    if (mark === 'profile' && session) {
      profile = await this.authorizeProfile.execute({
        session,
        userActivity: request.headers[USER_ACTIVITY_HEADER] === '1',
        unlockCookie: readCookie(request, UNLOCK_COOKIE),
      });
      attachIdentity(request, { session, profile });
    }

    // 4. Ré-authentification récente.
    const reauthMaxAge = this.reflector.get<number | undefined>(REAUTH_MARK, context.getHandler());
    if (reauthMaxAge !== undefined) {
      if (!session || !hasRecentReauth(session.record.reauthAt, this.clock.now(), reauthMaxAge)) {
        throw new ReauthRequiredError();
      }
    }
    return true;
  }

  /**
   * ADR 0013, « CSRF » : origine (`Sec-Fetch-Site`, à défaut `Origin`), puis jeton signé. Avec
   * une session, seul le jeton de cette session vaut ; sans session, sur une route publique, celui
   * de la pré-session. Une route publique appelée avec une session accepte les deux.
   */
  private async checkCsrf(
    request: Request,
    session: ResolvedSession | null,
    isPublic: boolean,
  ): Promise<void> {
    const received = request.headers[CSRF_HEADER];
    let accepted = false;
    if (this.sameOrigin(request) && typeof received === 'string' && received.length > 0) {
      if (session) {
        accepted = this.csrf.matches(this.csrf.forSession(session.record.tokenHash), received);
      }
      const presession = readCookie(request, PRESESSION_COOKIE);
      if (!accepted && isPublic && presession) {
        accepted = this.csrf.matches(this.csrf.forPresession(presession), received);
      }
    }
    if (accepted) return;

    const client = clientContextOf(request);
    await this.reportCsrfRejection.execute({
      accountId: session?.record.accountId ?? null,
      ip: client.ip,
      userAgent: client.userAgent,
    });
    throw new CsrfRejectedError();
  }

  private sameOrigin(request: Request): boolean {
    const site = request.headers['sec-fetch-site'];
    if (typeof site === 'string') return site === 'same-origin';
    const origin = request.headers.origin;
    return typeof origin === 'string' && origin === this.webOrigin;
  }
}
