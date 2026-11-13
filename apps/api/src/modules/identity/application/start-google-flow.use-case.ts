import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { AccountRepository } from '../domain/account.ports';
import { type GoogleRegistration, OIDC_FLOW_TTL_MS, type OidcFlow } from '../domain/google';
import {
  GoogleAlreadyLinkedError,
  GoogleNotLinkedError,
  GoogleUnavailableError,
} from '../domain/google.errors';
import { GoogleIdentityRepository, GoogleOidc, OidcFlows } from '../domain/google.ports';
import { RateLimiter, SecretTokens, type SessionRef } from '../domain/ports';
import { EmailNotVerifiedError } from '../domain/second-factor.errors';
import { RateLimitedError, SessionRequiredError } from '../domain/session.errors';
import type { ClientInfo } from './client-info';
import { SessionLifecycle } from './session-lifecycle';

export type StartGoogleFlowInput =
  | {
      /** Connexion ou inscription, avant session (AUTH-01, AUTH-03). */
      readonly kind: 'login';
      /** Cookie `__Host-lh_presession`, tel que reçu ; un nouveau est tiré s'il manque. */
      readonly presessionId: string | null;
      /** AUTH-08 : déclaration d'âge et premier profil, si l'utilisateur s'inscrit. */
      readonly registration: GoogleRegistration | null;
      readonly client: ClientInfo;
    }
  | {
      /** Association (AUTH-03) ou ré-authentification (AUTH-14), depuis une session. */
      readonly kind: 'link' | 'reauth';
      readonly session: SessionRef;
      readonly client: ClientInfo;
    };

export interface StartedGoogleFlow {
  readonly authorizationUrl: string;
  /** Identifiant de pré-session tiré ici, à poser dans `__Host-lh_presession` ; sinon `null`. */
  readonly newPresessionId: string | null;
}

/**
 * Départ vers Google (ADR 0013, « Retour OIDC ») : toujours par un `POST` protégé contre le CSRF.
 * `state`, `nonce` et `code_verifier` sont tirés ici (256 bits chacun) et gardés côté serveur
 * 10 minutes, liés à la pré-session (connexion) ou à `session.id` et à l'époque du compte
 * (association, ré-authentification). Seul `state` et le défi PKCE partent vers Google.
 *
 * Démarrages comptés par IP (`01`, « Limitation ») : chacun occupe Redis 10 minutes.
 */
@Injectable()
export class StartGoogleFlow {
  constructor(
    private readonly google: GoogleOidc,
    private readonly flows: OidcFlows,
    private readonly identities: GoogleIdentityRepository,
    private readonly accounts: AccountRepository,
    private readonly lifecycle: SessionLifecycle,
    private readonly limiter: RateLimiter,
    private readonly tokens: SecretTokens,
    private readonly clock: Clock,
  ) {}

  async execute(input: StartGoogleFlowInput): Promise<StartedGoogleFlow> {
    if (!this.google.enabled) throw new GoogleUnavailableError();
    const subjects = [{ scope: 'oidc_ip' as const, parts: [input.client.ip] }];
    const now = this.clock.now();
    const check = await this.limiter.check(subjects, now);
    if (!check.allowed || !check.reservation) throw new RateLimitedError(check.retryAfterMs);
    await this.limiter.recordFailure(subjects, now, check.reservation);

    let binding: string;
    let accountId: string | null = null;
    let epoch: number | null = null;
    let newPresessionId: string | null = null;
    if (input.kind === 'login') {
      const presessionId =
        input.presessionId && this.tokens.isWellFormed(input.presessionId)
          ? input.presessionId
          : (newPresessionId = this.tokens.generate());
      binding = this.tokens.hash(presessionId);
    } else {
      accountId = input.session.accountId;
      epoch = await this.checkAccount(accountId, input.kind);
      binding = input.session.id;
    }

    const state = this.tokens.generate();
    const flow: OidcFlow = {
      kind: input.kind,
      binding,
      accountId,
      epoch,
      nonce: this.tokens.generate(),
      codeVerifier: this.tokens.generate(),
      registration: input.kind === 'login' ? normalizeRegistration(input.registration) : null,
      createdAt: now,
    };
    const authorizationUrl = await this.google.authorizationUrl({
      state,
      nonce: flow.nonce,
      codeVerifier: flow.codeVerifier,
      fresh: input.kind === 'reauth',
    });
    await this.flows.create(this.tokens.hash(state), flow, OIDC_FLOW_TTL_MS);
    return { authorizationUrl, newPresessionId };
  }

  /**
   * Association : compte vérifié (AUTH-15), sans identité Google. Ré-authentification : identité
   * Google présente. Renvoie l'époque du compte, que le retour devra retrouver.
   */
  private async checkAccount(accountId: string, kind: 'link' | 'reauth'): Promise<number> {
    const state = await this.lifecycle.observe(accountId);
    const account = await this.accounts.findById(accountId);
    if (!state?.active || !account) throw new SessionRequiredError();
    const subject = await this.identities.findSubject(accountId);
    if (kind === 'link') {
      if (!account.emailVerified) throw new EmailNotVerifiedError();
      if (subject !== null) throw new GoogleAlreadyLinkedError();
    } else if (subject === null) {
      throw new GoogleNotLinkedError();
    }
    return state.epoch;
  }
}

function normalizeRegistration(registration: GoogleRegistration | null): GoogleRegistration | null {
  if (!registration) return null;
  return {
    displayName: registration.displayName.trim(),
    locale: registration.locale,
    timezone: registration.timezone,
  };
}
