import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  type ActiveProfile as ActiveProfileValue,
  REAUTH_MAX_AGE_MS,
  type ResolvedSession,
} from '../application/contract';

/**
 * Marques de route (ADR 0013, « Chaîne de gardes »). Une route porte exactement une marque
 * d'accès parmi `@Public()`, `@AccountScope()`, `@RequiresProfile()` ; un test le vérifie.
 */
export const ACCESS_MARK = 'identity:access';
export type AccessMark = 'public' | 'account' | 'profile';
export const REAUTH_MARK = 'identity:reauth-max-age';
export const OIDC_CALLBACK_MARK = 'identity:oidc-callback';

/** Route sans session (SEC-01) : liste explicite, vérifiée par le test « routes sans session ». */
export const Public = (): ClassDecorator & MethodDecorator => SetMetadata(ACCESS_MARK, 'public');

/**
 * Espace Compte (PIN-08) : session exigée, pas de profil. Ne renvoie que des métadonnées du
 * compte, jamais une liste, un élément ni une donnée d'offreur.
 */
export const AccountScope = (): ClassDecorator & MethodDecorator =>
  SetMetadata(ACCESS_MARK, 'account');

/** Profil actif présent et déverrouillé (PIN-02), sinon `423 PROFILE_LOCKED`. */
export const RequiresProfile = (): ClassDecorator & MethodDecorator =>
  SetMetadata(ACCESS_MARK, 'profile');

/** AUTH-14 : ré-authentification de moins de 10 minutes (2 pour PIN-05). */
export const RequiresRecentReauth = (maxAgeMs: number = REAUTH_MAX_AGE_MS): MethodDecorator =>
  applyDecorators(SetMetadata(REAUTH_MARK, maxAgeMs));

/**
 * Retour OIDC (`GET /auth/google/callback`) : seul `GET` qui modifie l'état, seule route sans
 * contrôle CSRF, protégée par `state`, `nonce` et la liaison à la pré-session (ADR 0013).
 */
export const OidcCallback = (): MethodDecorator => SetMetadata(OIDC_CALLBACK_MARK, true);

/** État d'identité attaché à la requête par la chaîne de gardes. */
export interface RequestIdentity {
  session: ResolvedSession | null;
  profile: ActiveProfileValue | null;
}

const IDENTITY = Symbol('identity');

export function attachIdentity(request: Request, identity: RequestIdentity): void {
  (request as Request & { [IDENTITY]?: RequestIdentity })[IDENTITY] = identity;
}

export function identityOf(request: Request): RequestIdentity | undefined {
  return (request as Request & { [IDENTITY]?: RequestIdentity })[IDENTITY];
}

/** Session de la requête (API-11). Absente sur une route publique sans session. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ResolvedSession | null =>
    identityOf(ctx.switchToHttp().getRequest<Request>())?.session ?? null,
);

/**
 * Profil actif déverrouillé (API-11, SEC-03). Seule source du profil : jamais un paramètre. Une
 * route sans `@RequiresProfile()` qui l'utiliserait est une erreur de programmation.
 */
export const ActiveProfile = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ActiveProfileValue => {
    const profile = identityOf(ctx.switchToHttp().getRequest<Request>())?.profile;
    if (!profile) throw new Error('@ActiveProfile() sans @RequiresProfile()');
    return profile;
  },
);

export interface ClientContextValue {
  /** Adresse retenue par `trust proxy` (`TRUSTED_PROXY_HOPS`), seule source (SEC-30). */
  readonly ip: string;
  readonly userAgent: string;
}

export function clientContextOf(request: Request): ClientContextValue {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip ?? request.socket.remoteAddress ?? '0.0.0.0',
    userAgent: typeof userAgent === 'string' ? userAgent : '',
  };
}

export const ClientContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClientContextValue =>
    clientContextOf(ctx.switchToHttp().getRequest<Request>()),
);
