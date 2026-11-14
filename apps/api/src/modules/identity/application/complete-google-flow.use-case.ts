import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import {
  accentColorFor,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  EMAIL_MAX_LENGTH,
  normalizeEmail,
} from '../domain/account';
import { AccountSuspendedError, InvitationRequiredError } from '../domain/account.errors';
import { AccountRepository, BackgroundTasks, IdentitySettings } from '../domain/account.ports';
import {
  decideNewGoogleAccount,
  GOOGLE_REAUTH_PROOF_TTL_MS,
  type GoogleClaims,
  isFreshFor,
  type OidcFlow,
} from '../domain/google';
import {
  GoogleAlreadyLinkedElsewhereError,
  GoogleAlreadyLinkedError,
  GoogleEmailUnavailableError,
  GoogleEmailUnverifiedError,
  GoogleFlowInvalidError,
  GoogleIdentityMismatchError,
  GoogleLinkRequiredError,
  GoogleRegistrationRequiredError,
  GoogleRejectedError,
} from '../domain/google.errors';
import {
  GoogleIdentityRepository,
  GoogleOidc,
  GoogleReauthProofs,
  OidcFlows,
} from '../domain/google.ports';
import { LinkRepository } from '../domain/link.ports';
import {
  EventThrottle,
  IdentityEvents,
  type SecurityEvent,
  SecretTokens,
  SecurityLog,
  type SessionRef,
} from '../domain/ports';
import { hasRecentReauth, REAUTH_MAX_AGE_MS } from '../domain/session';
import { ReauthRequiredError } from '../domain/session.errors';
import { EmailNotVerifiedError } from '../domain/second-factor.errors';
import { AccountMailer } from './account-mailer';
import type { ClientInfo } from './client-info';
import { RemoveUnverifiedAccount } from './remove-unverified-account';
import { type IssuedSession, SessionLifecycle } from './session-lifecycle';
import { SignInCompletion } from './sign-in-completion';

/** Une ligne au plus par minute et par (adresse, compte) pour les retours refusés. */
const REJECTION_LOG_WINDOW_MS = 60_000;

/** Marge ajoutée à « maintenant » pour qu'un compte créé à l'instant compte comme antérieur. */
const REPLACE_CUTOFF_MARGIN_MS = 1000;

export type GoogleOutcome =
  /** Connexion : session neuve. */
  | { readonly kind: 'signed_in'; readonly issued: IssuedSession }
  /** Connexion : TOTP attendu (AUTH-12), jeton de pré-authentification. */
  | { readonly kind: 'second_factor'; readonly pendingToken: string }
  /** Association faite (AUTH-03). */
  | { readonly kind: 'linked' }
  /** Ré-authentification faite : même session, nouveau jeton (AUTH-14). */
  | { readonly kind: 'reauthenticated'; readonly issued: IssuedSession }
  /** Ré-authentification : Google validé, code TOTP attendu par `POST /auth/reauth`. */
  | { readonly kind: 'reauth_second_factor' };

/**
 * Retour de Google (ADR 0013, « Retour OIDC » ; AUTH-03, AUTH-12, AUTH-14, AUTH-15).
 *
 * 1. `state` consommé (`GETDEL`) **avant** toute autre vérification : un retour rejoué ne trouve
 *    plus rien, même s'il échoue ensuite.
 * 2. Le parcours doit avoir été démarré par **ce** navigateur : même pré-session (connexion), même
 *    session (association, ré-authentification). Un lien de retour fabriqué par un tiers avec son
 *    propre compte Google n'ouvre donc rien chez la victime (CSRF de connexion).
 * 3. Échange du code (PKCE) et vérification du jeton d'identité par l'adaptateur.
 * 4. Décision ; aucune fusion par adresse (AUTH-03).
 */
@Injectable()
export class CompleteGoogleFlow {
  constructor(
    private readonly google: GoogleOidc,
    private readonly flows: OidcFlows,
    private readonly proofs: GoogleReauthProofs,
    private readonly identities: GoogleIdentityRepository,
    private readonly accounts: AccountRepository,
    private readonly links: LinkRepository,
    private readonly removal: RemoveUnverifiedAccount,
    private readonly events: IdentityEvents,
    private readonly lifecycle: SessionLifecycle,
    private readonly completion: SignInCompletion,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly settings: IdentitySettings,
    private readonly tokens: SecretTokens,
    private readonly securityLog: SecurityLog,
    private readonly throttle: EventThrottle,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    /** Chaîne de requête du retour, telle que reçue (sans `?`). */
    readonly callbackQuery: string;
    /** Cookie `__Host-lh_presession`, tel que reçu. */
    readonly presessionId: string | null;
    readonly session: SessionRef | null;
    /** `reauth_at` de la session courante : l'association l'exige encore au retour (AUTH-14). */
    readonly reauthAt: Date | null;
    /** Cookie `__Host-lh_device`, tel que reçu. */
    readonly deviceToken: string | null;
    readonly client: ClientInfo;
  }): Promise<GoogleOutcome> {
    const state = new URLSearchParams(input.callbackQuery).get('state');
    if (!state || !this.tokens.isWellFormed(state)) throw new GoogleFlowInvalidError();
    const flow = await this.flows.consume(this.tokens.hash(state));
    // Un `state` inconnu n'est pas un événement de sécurité (n'importe qui peut en forger) ; un
    // parcours présenté par un autre navigateur l'est, journalisé avec parcimonie.
    if (!flow) throw new GoogleFlowInvalidError();
    if (!this.isBound(flow, input.presessionId, input.session)) {
      await this.logRejection(input.session?.accountId ?? null, input.client);
      throw new GoogleFlowInvalidError();
    }
    // AUTH-14 : la ré-authentification est effacée au verrouillage et au changement de profil.
    // Celle qui a permis le départ doit encore valoir au retour : qui reprend l'appareil entre les
    // deux n'associe pas son propre compte Google.
    if (
      flow.kind === 'link' &&
      !hasRecentReauth(input.reauthAt, this.clock.now(), REAUTH_MAX_AGE_MS)
    ) {
      throw new ReauthRequiredError();
    }

    let claims: GoogleClaims;
    try {
      claims = await this.google.exchange({
        callbackQuery: input.callbackQuery,
        state,
        nonce: flow.nonce,
        codeVerifier: flow.codeVerifier,
        fresh: flow.kind === 'reauth',
      });
    } catch (error) {
      if (error instanceof GoogleRejectedError) {
        await this.logRejection(flow.accountId, input.client);
      }
      throw error;
    }

    switch (flow.kind) {
      case 'login':
        return this.signIn(flow, claims, input);
      case 'link':
        return this.link(flow, claims, input.client);
      case 'reauth':
        // `isBound` a vérifié la session pour ce genre de parcours.
        return this.reauthenticate(flow, claims, input.session as SessionRef, input.client);
    }
  }

  private isBound(
    flow: OidcFlow,
    presessionId: string | null,
    session: SessionRef | null,
  ): boolean {
    if (flow.kind === 'login') {
      return (
        presessionId !== null &&
        this.tokens.isWellFormed(presessionId) &&
        this.tokens.hash(presessionId) === flow.binding
      );
    }
    return session !== null && session.id === flow.binding && session.accountId === flow.accountId;
  }

  private async signIn(
    flow: OidcFlow,
    claims: GoogleClaims,
    input: { session: SessionRef | null; deviceToken: string | null; client: ClientInfo },
  ): Promise<GoogleOutcome> {
    const found = await this.identities.findAccountBySubject(claims.subject);
    const accountId = found ?? (await this.createAccount(flow, claims, input.client));
    // ADR 0014 : l'époque est lue, puis l'identité relue. Une dissociation terminée entre la
    // première lecture et l'époque ne laisse pas ouvrir une session à la nouvelle époque.
    const state = await this.lifecycle.observe(accountId);
    const account = await this.accounts.findById(accountId);
    if (
      !state ||
      !account ||
      (await this.identities.findAccountBySubject(claims.subject)) !== accountId
    ) {
      throw new GoogleFlowInvalidError();
    }
    // AUTH-09 : un compte né d'une invitation non consommée ne s'ouvre pas (reprise impossible ici).
    if (!account.emailVerified) throw new GoogleFlowInvalidError();
    if (!account.active || !state.active) {
      await this.log(accountId, 'login.failed', input.client);
      throw new AccountSuspendedError();
    }
    const device = await this.completion.trustedDevice(input.deviceToken);
    const result = await this.completion.complete({
      state,
      totpEnabled: account.totpEnabled,
      deviceId: device?.accountId === accountId ? device.id : null,
      client: input.client,
      previous: input.session,
    });
    return result.kind === 'session'
      ? { kind: 'signed_in', issued: result.issued }
      : { kind: 'second_factor', pendingToken: result.pendingToken };
  }

  /**
   * Aucune identité pour ce `sub` (AUTH-03, AUTH-15) : inscription si l'adresse est libre ou
   * celle d'un compte non vérifié, jamais de rattachement à un compte vérifié.
   */
  private async createAccount(
    flow: OidcFlow,
    claims: GoogleClaims,
    client: ClientInfo,
  ): Promise<string> {
    const email = claims.email ? normalizeEmail(claims.email) : '';
    if (email.length > EMAIL_MAX_LENGTH) throw new GoogleEmailUnavailableError();
    const now = this.clock.now();
    const existing = email ? await this.accounts.findByEmail(email) : null;
    const decision = decideNewGoogleAccount({
      claims,
      existing,
      reserved: email ? await this.accounts.isEmailReserved(email, null, now) : false,
    });
    switch (decision) {
      case 'unverified_email':
        throw new GoogleEmailUnverifiedError();
      case 'link_required':
        throw new GoogleLinkRequiredError();
      case 'unavailable':
        throw new GoogleEmailUnavailableError();
      case 'replace':
      case 'create':
        break;
    }
    const registration = flow.registration;
    if (!registration) throw new GoogleRegistrationRequiredError();
    // AUTH-09, LNK-08 : en `INVITE_ONLY`, une invitation ouverte est exigée avant toute écriture.
    const invitation = registration.invitationTokenHash
      ? await this.links.findOpenInvitation(registration.invitationTokenHash, now)
      : null;
    if (this.settings.registrationMode === 'INVITE_ONLY' && !invitation) {
      throw new InvitationRequiredError();
    }
    if (decision === 'replace' && existing)
      await this.replaceUnverified(existing.accountId, client);

    const accountId = this.ids.next();
    const profileId = this.ids.next();
    const created = await this.identities.createAccount({
      id: accountId,
      email,
      subject: claims.subject,
      identityId: this.ids.next(),
      ageAttestedAt: now,
      createdAt: now,
      pendingInvitationId: invitation?.id ?? null,
      profile: {
        id: profileId,
        displayName: registration.displayName,
        accentColor: accentColorFor(profileId),
        locale: registration.locale ?? DEFAULT_LOCALE,
        currency: DEFAULT_CURRENCY,
        timezone: registration.timezone ?? DEFAULT_TIMEZONE,
      },
    });
    // Création concurrente de la même adresse ou du même identifiant : rien n'est rattaché.
    if (created === 'email_taken') throw new GoogleLinkRequiredError();
    if (created === 'subject_taken') throw new GoogleFlowInvalidError();
    await this.log(accountId, 'account.registered', client);
    if (invitation) await this.consumeInvitation(accountId, client);
    return accountId;
  }

  /**
   * AUTH-09, LNK-08 : un compte créé avec une invitation naît non vérifié ; la consommation crée le
   * lien et vérifie l'adresse (déjà vérifiée par Google) dans une transaction. Épuisée entre la
   * lecture et la création (ouverture concurrente du même jeton) : en `INVITE_ONLY` le compte est
   * supprimé et le retour refusé ; en `OPEN` l'adresse est simplement vérifiée, sans lien.
   */
  private async consumeInvitation(accountId: string, client: ClientInfo): Promise<void> {
    const now = this.clock.now();
    const linkId = this.ids.next();
    const outcome = await this.links.consumePendingInvitation({ accountId, linkId, now });
    if (
      (outcome === 'exhausted' || outcome === 'none') &&
      this.settings.registrationMode === 'INVITE_ONLY'
    ) {
      await this.removal.execute(accountId);
      throw new InvitationRequiredError();
    }
    if (outcome !== 'linked') {
      await this.accounts.markEmailVerified(accountId, now);
      return;
    }
    await this.log(accountId, 'link.created', client);
    const link = await this.links.findLink(linkId);
    if (link) this.events.publish({ type: 'circle.changed', profileIds: [link.a.id, link.b.id] });
  }

  /**
   * AUTH-15 : le compte local non vérifié de même adresse est supprimé avec ses sessions, dans
   * l'ordre de l'ADR 0013 (époque et suspension, révocation, suppression). S'il a été vérifié
   * entre-temps, rien n'est remplacé : refus comme pour un compte vérifié.
   */
  private async replaceUnverified(accountId: string, client: ClientInfo): Promise<void> {
    const cutoff = new Date(this.clock.now().getTime() + REPLACE_CUTOFF_MARGIN_MS);
    const outcome = { suspended: false };
    await this.lifecycle.changeEpoch(accountId, async (authEpoch) => {
      outcome.suspended = await this.accounts.suspendUnverified(accountId, cutoff, authEpoch);
    });
    if (!outcome.suspended || !(await this.accounts.deleteUnverified(accountId))) {
      throw new GoogleLinkRequiredError();
    }
    await this.log(accountId, 'account.replaced', client);
  }

  /** AUTH-03 : association depuis la session qui a démarré le parcours, à la même époque. */
  private async link(
    flow: OidcFlow,
    claims: GoogleClaims,
    client: ClientInfo,
  ): Promise<GoogleOutcome> {
    const accountId = flow.accountId as string;
    const state = await this.lifecycle.observe(accountId);
    if (!state?.active || state.epoch !== flow.epoch) throw new GoogleFlowInvalidError();
    const owner = await this.identities.findAccountBySubject(claims.subject);
    if (owner === accountId) throw new GoogleAlreadyLinkedError();
    if (owner !== null) throw new GoogleAlreadyLinkedElsewhereError();

    const result = await this.identities.link({
      id: this.ids.next(),
      accountId,
      subject: claims.subject,
      now: this.clock.now(),
    });
    if (result === 'subject_taken') throw new GoogleAlreadyLinkedElsewhereError();
    if (result === 'already_linked') throw new GoogleAlreadyLinkedError();
    if (result === 'not_eligible') throw new EmailNotVerifiedError();

    await this.log(accountId, 'google.linked', client);
    this.background.run('google.linked_notice', async () => {
      const current = await this.accounts.findById(accountId);
      if (current) await this.mailer.send(current.email, { kind: 'google_linked' });
    });
    return { kind: 'linked' };
  }

  /**
   * AUTH-14 : l'identité Google associée, et nulle autre ; fraîcheur vérifiée par l'adaptateur.
   * Avec le TOTP, une preuve liée au jeton courant attend le code (5 minutes).
   */
  private async reauthenticate(
    flow: OidcFlow,
    claims: GoogleClaims,
    session: SessionRef,
    client: ClientInfo,
  ): Promise<GoogleOutcome> {
    const state = await this.lifecycle.observe(session.accountId);
    if (!state?.active || state.epoch !== flow.epoch) throw new GoogleFlowInvalidError();
    // Fraîcheur mesurée au départ du parcours : une connexion Google faite sur l'appareil avant
    // le départ ne suffit pas, quoi que Google fasse de `max_age=0`.
    if (!isFreshFor(claims.authTime, flow.createdAt)) {
      await this.logRejection(session.accountId, client);
      throw new GoogleRejectedError();
    }
    if ((await this.identities.findSubject(session.accountId)) !== claims.subject) {
      await this.log(session.accountId, 'reauth.failed', client);
      throw new GoogleIdentityMismatchError();
    }
    const account = await this.accounts.findById(session.accountId);
    if (!account) throw new GoogleFlowInvalidError();
    if (account.totpEnabled) {
      await this.proofs.create(
        session.id,
        { tokenHash: session.tokenHash, epoch: state.epoch, createdAt: this.clock.now() },
        GOOGLE_REAUTH_PROOF_TTL_MS,
      );
      return { kind: 'reauth_second_factor' };
    }
    const issued = await this.lifecycle.rotate(session);
    await this.log(session.accountId, 'reauth.succeeded', client);
    return { kind: 'reauthenticated', issued };
  }

  /** Une ligne par minute au plus par (adresse, compte) : le journal est en ajout seul (DAT-02). */
  private async logRejection(accountId: string | null, client: ClientInfo): Promise<void> {
    if (
      await this.throttle.firstInWindow(
        ['google.rejected', client.ip, accountId ?? 'anonyme'],
        REJECTION_LOG_WINDOW_MS,
      )
    ) {
      await this.log(accountId, 'google.rejected', client);
    }
  }

  private async log(accountId: string | null, event: SecurityEvent, client: ClientInfo) {
    await this.securityLog.record({
      accountId,
      event,
      ip: client.ip,
      userAgent: client.userAgent,
      at: this.clock.now(),
    });
  }
}
