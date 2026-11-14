/* eslint-disable @typescript-eslint/require-await -- doubles synchrones derrière des ports asynchrones */
// Doubles en mémoire du parcours Google, pour les tests (exportés par `testing.ts`).
import { createHash, randomBytes } from 'node:crypto';
import type { GoogleClaims, GoogleReauthProof, OidcFlow } from '../domain/google';
import { GoogleRejectedError } from '../domain/google.errors';
import {
  GoogleIdentityRepository,
  GoogleOidc,
  GoogleReauthProofs,
  type NewGoogleAccount,
  OidcFlows,
} from '../domain/google.ports';
import { IdentityUnavailableError } from '../domain/session.errors';
import type { InMemoryAccountRepository, InMemorySessionStore } from './in-memory';

const base64url = (bytes: Buffer): string => bytes.toString('base64url');

/**
 * Google simulé. `authorizationUrl` retient ce qui part vers Google (`state`, `nonce`, défi PKCE,
 * fraîcheur) ; `approve` joue l'utilisateur qui se connecte et rend la chaîne de requête du
 * retour ; `exchange` refuse, comme `openid-client`, un code inconnu ou déjà utilisé, un `state`,
 * un `nonce` ou un vérificateur PKCE qui ne correspondent pas, une fraîcheur manquante.
 */
export class FakeGoogleOidc extends GoogleOidc {
  enabled = true;
  unreachable = false;
  readonly authorizations = new Map<
    string,
    { readonly nonce: string; readonly challenge: string; readonly fresh: boolean }
  >();
  private readonly codes = new Map<
    string,
    { readonly state: string; readonly claims: GoogleClaims; readonly fresh: boolean }
  >();

  async authorizationUrl(input: {
    state: string;
    nonce: string;
    codeVerifier: string;
    fresh: boolean;
  }): Promise<string> {
    if (this.unreachable) throw new IdentityUnavailableError();
    const challenge = base64url(createHash('sha256').update(input.codeVerifier).digest());
    this.authorizations.set(input.state, { nonce: input.nonce, challenge, fresh: input.fresh });
    const url = new URL('https://accounts.google.test/o/oauth2/v2/auth');
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', challenge);
    if (input.fresh) url.searchParams.set('max_age', '0');
    return url.href;
  }

  /**
   * L'utilisateur se connecte chez Google pour l'URL donnée ; renvoie la chaîne de requête du
   * retour. `freshAuth` faux : Google n'a pas redemandé l'authentification.
   */
  approve(
    authorizationUrl: string,
    claims: { subject: string; email?: string | null; emailVerified?: boolean },
    options: { freshAuth?: boolean; state?: string; authTime?: Date } = {},
  ): string {
    const state = options.state ?? new URL(authorizationUrl).searchParams.get('state') ?? '';
    const code = base64url(randomBytes(16));
    this.codes.set(code, {
      state,
      claims: {
        subject: claims.subject,
        email: claims.email === undefined ? `${claims.subject}@gmail.test` : claims.email,
        emailVerified: claims.emailVerified ?? true,
        // Authentification fraîche : maintenant ; sinon, une heure plus tôt.
        authTime:
          options.authTime ?? new Date(Date.now() - ((options.freshAuth ?? true) ? 0 : 3_600_000)),
      },
      fresh: options.freshAuth ?? true,
    });
    return new URLSearchParams({ state, code }).toString();
  }

  async exchange(input: {
    callbackQuery: string;
    state: string;
    nonce: string;
    codeVerifier: string;
    fresh: boolean;
  }): Promise<GoogleClaims> {
    if (this.unreachable) throw new IdentityUnavailableError();
    const params = new URLSearchParams(input.callbackQuery);
    if (params.has('error')) throw new GoogleRejectedError();
    const code = params.get('code') ?? '';
    const issued = this.codes.get(code);
    this.codes.delete(code);
    const sent = this.authorizations.get(input.state);
    const challenge = base64url(createHash('sha256').update(input.codeVerifier).digest());
    if (
      !issued ||
      !sent ||
      issued.state !== input.state ||
      params.get('state') !== input.state ||
      sent.nonce !== input.nonce ||
      sent.challenge !== challenge ||
      (input.fresh && !issued.fresh)
    ) {
      throw new GoogleRejectedError();
    }
    return issued.claims;
  }
}

/** Parcours en cours, avec leur durée de vie (horloge réelle). */
export class InMemoryOidcFlows extends OidcFlows {
  readonly entries = new Map<string, { flow: OidcFlow; expiresAt: number }>();

  async create(stateHash: string, flow: OidcFlow, ttlMs: number): Promise<void> {
    this.entries.set(stateHash, { flow, expiresAt: Date.now() + ttlMs });
  }

  async consume(stateHash: string): Promise<OidcFlow | null> {
    const entry = this.entries.get(stateHash);
    this.entries.delete(stateHash);
    return entry && entry.expiresAt > Date.now() ? entry.flow : null;
  }

  /** Simule l'expiration des 10 minutes. */
  expireAll(): void {
    for (const entry of this.entries.values()) entry.expiresAt = 0;
  }
}

export class InMemoryGoogleReauthProofs extends GoogleReauthProofs {
  readonly entries = new Map<string, { proof: GoogleReauthProof; expiresAt: number }>();

  async create(sessionId: string, proof: GoogleReauthProof, ttlMs: number): Promise<void> {
    this.entries.set(sessionId, { proof, expiresAt: Date.now() + ttlMs });
  }

  async find(sessionId: string): Promise<GoogleReauthProof | null> {
    const entry = this.entries.get(sessionId);
    return entry && entry.expiresAt > Date.now() ? entry.proof : null;
  }

  async consume(sessionId: string): Promise<GoogleReauthProof | null> {
    const found = await this.find(sessionId);
    this.entries.delete(sessionId);
    return found;
  }

  expireAll(): void {
    for (const entry of this.entries.values()) entry.expiresAt = 0;
  }
}

/**
 * Identités Google en mémoire, adossées aux comptes en mémoire (état d'authentification dans le
 * magasin de sessions en mémoire), mêmes contraintes d'unicité qu'en base.
 */
export class InMemoryGoogleIdentityRepository extends GoogleIdentityRepository {
  /** `sub` → compte. */
  readonly identities = new Map<string, string>();

  constructor(
    private readonly accounts: InMemoryAccountRepository,
    private readonly sessions: InMemorySessionStore,
  ) {
    super();
  }

  async findAccountBySubject(subject: string): Promise<string | null> {
    return this.identities.get(subject) ?? null;
  }

  async findSubject(accountId: string): Promise<string | null> {
    for (const [subject, owner] of this.identities) if (owner === accountId) return subject;
    return null;
  }

  async createAccount(
    account: NewGoogleAccount,
  ): Promise<'created' | 'email_taken' | 'subject_taken'> {
    if (await this.accounts.findByEmail(account.email)) return 'email_taken';
    if (this.identities.has(account.subject)) return 'subject_taken';
    this.accounts.seed({
      id: account.id,
      email: account.email,
      passwordHash: null,
      emailVerifiedAt: account.pendingInvitationId ? null : account.createdAt,
      createdAt: account.createdAt,
      pendingInvitationId: account.pendingInvitationId ?? null,
    });
    this.accounts.profiles.set(account.profile.id, { ...account.profile, accountId: account.id });
    this.identities.set(account.subject, account.id);
    return 'created';
  }

  async link(input: {
    id: string;
    accountId: string;
    subject: string;
    now: Date;
  }): Promise<'linked' | 'subject_taken' | 'already_linked' | 'not_eligible'> {
    const account = await this.accounts.findById(input.accountId);
    if (!account?.active || !account.emailVerified) return 'not_eligible';
    if (this.identities.has(input.subject)) return 'subject_taken';
    if ((await this.findSubject(input.accountId)) !== null) return 'already_linked';
    this.identities.set(input.subject, input.accountId);
    return 'linked';
  }

  async unlink(
    accountId: string,
    authEpoch: number,
  ): Promise<'unlinked' | 'not_linked' | 'no_password'> {
    this.sessions.commitEpoch(accountId, authEpoch);
    if (!(await this.accounts.findById(accountId))?.passwordHash) return 'no_password';
    const subject = await this.findSubject(accountId);
    if (subject === null) return 'not_linked';
    this.identities.delete(subject);
    return 'unlinked';
  }
}
