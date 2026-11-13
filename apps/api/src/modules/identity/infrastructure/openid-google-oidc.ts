import { Injectable } from '@nestjs/common';
import * as oidc from 'openid-client';
import { AppConfig } from '../../../platform/config/env';
import { GOOGLE_REAUTH_MAX_AGE_SECONDS, type GoogleClaims, isValidSubject } from '../domain/google';
import { GoogleRejectedError, GoogleUnavailableError } from '../domain/google.errors';
import { GoogleOidc } from '../domain/google.ports';
import { IdentityUnavailableError } from '../domain/session.errors';

/**
 * Retour de Google, servi par `GoogleController.googleCallback` sous le préfixe de l'API. Doit
 * figurer tel quel dans les URI de redirection autorisées du client Google.
 */
export const GOOGLE_CALLBACK_PATH = '/api/v1/auth/google/callback';

/** AUTH-03, RGPD-02 : identifiant et adresse, rien d'autre (ni nom, ni photo). */
const SCOPE = 'openid email';

/** Secondes : au-delà, Google est tenu pour indisponible. */
const REQUEST_TIMEOUT_SECONDS = 5;

/**
 * Adaptateur `openid-client` (ADR 0003). Code + PKCE (`S256`), client confidentiel
 * (`client_secret_post`). `authorizationCodeGrant` vérifie `state`, puis, sur le jeton
 * d'identité, `iss`, `aud`, `azp`, `exp`, `iat`, `nonce` et, si demandé, la fraîcheur
 * (`auth_time`). Le jeton d'identité vient du point de terminaison de Google par TLS, qui en garantit
 * l'émetteur (OIDC Core, 3.1.3.7) ; aucun jeton de Google n'est conservé.
 *
 * Erreurs : réponse invalide → `GoogleRejectedError` (raison ni renvoyée ni journalisée) ; Google
 * injoignable → `IdentityUnavailableError`. Les messages d'`openid-client` ne sortent jamais :
 * ils peuvent citer des valeurs du jeton.
 */
@Injectable()
export class OpenIdGoogleOidc extends GoogleOidc {
  readonly enabled: boolean;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly issuer: URL;
  private readonly redirectUri: string;
  private readonly allowHttp: boolean;
  private configuration: Promise<oidc.Configuration> | null = null;

  constructor(config: AppConfig) {
    super();
    this.clientId = config.env.GOOGLE_CLIENT_ID;
    this.clientSecret = config.env.GOOGLE_CLIENT_SECRET;
    this.enabled = this.clientId !== undefined && this.clientSecret !== undefined;
    this.issuer = new URL(config.env.GOOGLE_OIDC_ISSUER);
    this.redirectUri = `${config.env.WEB_ORIGIN.replace(/\/+$/, '')}${GOOGLE_CALLBACK_PATH}`;
    // Fournisseur local des tests seulement : la configuration refuse `http:` en production.
    this.allowHttp = config.env.NODE_ENV !== 'production' && this.issuer.protocol === 'http:';
  }

  async authorizationUrl(input: {
    readonly state: string;
    readonly nonce: string;
    readonly codeVerifier: string;
    readonly fresh: boolean;
  }): Promise<string> {
    const configuration = await this.configured();
    const parameters: Record<string, string> = {
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: SCOPE,
      state: input.state,
      nonce: input.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(input.codeVerifier),
      code_challenge_method: 'S256',
    };
    // AUTH-14 : une session Google restée ouverte dans le navigateur ne suffit pas.
    // AUTH-03 : toujours choisir le compte Google, pour ne pas associer celui d'un proche resté
    // ouvert dans le navigateur.
    parameters.prompt = 'select_account';
    if (input.fresh) parameters.max_age = '0';
    return oidc.buildAuthorizationUrl(configuration, parameters).href;
  }

  async exchange(input: {
    readonly callbackQuery: string;
    readonly state: string;
    readonly nonce: string;
    readonly codeVerifier: string;
    readonly fresh: boolean;
  }): Promise<GoogleClaims> {
    const configuration = await this.configured();
    const currentUrl = new URL(this.redirectUri);
    currentUrl.search = input.callbackQuery;
    let claims: oidc.IDToken | undefined;
    try {
      const tokens = await oidc.authorizationCodeGrant(configuration, currentUrl, {
        pkceCodeVerifier: input.codeVerifier,
        expectedState: input.state,
        expectedNonce: input.nonce,
        idTokenExpected: true,
        ...(input.fresh ? { maxAge: GOOGLE_REAUTH_MAX_AGE_SECONDS } : {}),
      });
      claims = tokens.claims();
    } catch (error) {
      throw isUnreachable(error) ? new IdentityUnavailableError() : new GoogleRejectedError();
    }
    if (!claims || typeof claims.sub !== 'string' || !isValidSubject(claims.sub)) {
      throw new GoogleRejectedError();
    }
    const email = typeof claims.email === 'string' ? claims.email : null;
    return {
      subject: claims.sub,
      email,
      // Seul le booléen `true` vaut vérification (jamais une chaîne, jamais une absence).
      emailVerified: email !== null && claims.email_verified === true,
      authTime:
        typeof claims.auth_time === 'number' && Number.isFinite(claims.auth_time)
          ? new Date(claims.auth_time * 1000)
          : null,
    };
  }

  /** Découverte faite une fois, refaite après un échec. */
  private configured(): Promise<oidc.Configuration> {
    if (!this.enabled || !this.clientId || !this.clientSecret) {
      return Promise.reject(new GoogleUnavailableError());
    }
    if (!this.configuration) {
      const execute = this.allowHttp
        ? // eslint-disable-next-line @typescript-eslint/no-deprecated -- fournisseur local des tests, jamais en production (configuration)
          [oidc.allowInsecureRequests]
        : [];
      this.configuration = oidc
        .discovery(this.issuer, this.clientId, this.clientSecret, undefined, {
          execute,
          timeout: REQUEST_TIMEOUT_SECONDS,
        })
        .catch(() => {
          this.configuration = null;
          throw new IdentityUnavailableError();
        });
    }
    return this.configuration;
  }
}

/**
 * Google n'a pas répondu (réseau, délai), par opposition à une réponse refusée. Les erreurs
 * d'`openid-client` portent un `code` (`OAUTH_*`) ou sont des réponses du serveur.
 */
function isUnreachable(error: unknown): boolean {
  if (error instanceof oidc.ResponseBodyError) return error.status >= 500;
  if (error instanceof oidc.AuthorizationResponseError) return false;
  if (error instanceof oidc.WWWAuthenticateChallengeError) return false;
  // Statut 5xx sans corps d'erreur OAuth : `ClientError` dont la cause est la réponse.
  if (error instanceof oidc.ClientError) {
    return error.cause instanceof Response && error.cause.status >= 500;
  }
  return true;
}
