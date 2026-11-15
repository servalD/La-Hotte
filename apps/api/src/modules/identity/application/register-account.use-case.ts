import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import {
  accentColorFor,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  normalizeEmail,
  tokenExpiry,
} from '../domain/account';
import { InvitationRequiredError } from '../domain/account.errors';
import { LinkRepository } from '../domain/link.ports';
import { AccountRepository, BackgroundTasks, IdentitySettings } from '../domain/account.ports';
import { RateLimiter, SecretTokens, SecurityLog } from '../domain/ports';
import { RateLimitedError } from '../domain/session.errors';
import { AccountMailer } from './account-mailer';
import type { ClientInfo } from './client-info';
import { PasswordPolicy } from './password-policy';

export interface RegisterAccountInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  /** AUTH-08 : vrai seulement si la case a été cochée (le DTO refuse toute autre valeur). */
  readonly ageAttested: true;
  readonly locale?: string;
  readonly timezone?: string;
  /** LNK-08 : jeton d'invitation, en clair, tel que reçu. */
  readonly invitationToken?: string;
  readonly client: ClientInfo;
}

interface PendingRegistration {
  readonly email: string;
  readonly passwordHash: string;
  readonly displayName: string;
  readonly locale: string | undefined;
  readonly timezone: string | undefined;
  readonly invitationId: string | null;
  readonly client: ClientInfo;
}

/**
 * Inscription par e-mail et mot de passe (AUTH-01, AUTH-02, AUTH-08, AUTH-09, PRO-01).
 *
 * Anti-énumération (ADR 0013) : la réponse ne dépend que de la limitation par IP, du mode
 * d'inscription et du mot de passe, jamais de l'existence de l'adresse. Le hachage argon2 est fait
 * dans tous les cas ; la recherche de l'adresse, l'écriture et l'e-mail viennent après la réponse.
 * Adresse déjà prise : le titulaire est averti, rien n'est créé.
 */
@Injectable()
export class RegisterAccount {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly passwords: PasswordPolicy,
    private readonly limiter: RateLimiter,
    private readonly tokens: SecretTokens,
    private readonly links: LinkRepository,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly securityLog: SecurityLog,
    private readonly settings: IdentitySettings,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: RegisterAccountInput): Promise<void> {
    const subjects = [{ scope: 'register_ip' as const, parts: [input.client.ip] }];
    const now = this.clock.now();
    const check = await this.limiter.check(subjects, now);
    if (!check.allowed || !check.reservation) throw new RateLimitedError(check.retryAfterMs);
    await this.limiter.recordFailure(subjects, now, check.reservation);

    // AUTH-09, LNK-08 : en `INVITE_ONLY`, une invitation ouverte est exigée ; le contrôle ne dépend
    // pas de l'adresse, la réponse ne dit donc rien d'un compte existant. En `OPEN`, une invitation
    // invalide est ignorée sans bruit.
    const invitation = input.invitationToken
      ? await this.links.findOpenInvitation(this.tokens.hash(input.invitationToken), now)
      : null;
    if (this.settings.registrationMode === 'INVITE_ONLY' && !invitation) {
      throw new InvitationRequiredError();
    }

    const passwordHash = await this.passwords.hashNew(input.password);
    // Le mot de passe en clair ne passe pas dans la tâche de fond : seulement son hash.
    const pending: PendingRegistration = {
      email: normalizeEmail(input.email),
      passwordHash,
      displayName: input.displayName,
      locale: input.locale,
      timezone: input.timezone,
      invitationId: invitation?.id ?? null,
      client: input.client,
    };
    this.background.run('account.register', () => this.createOrWarn(pending));
  }

  private async createOrWarn(input: PendingRegistration): Promise<void> {
    const now = this.clock.now();
    // Adresse prise, ou réservée par un lien d'annulation ouvert (AUTH-16) : rien n'est créé.
    if (
      (await this.accounts.findByEmail(input.email)) ||
      (await this.accounts.isEmailReserved(input.email, null, now))
    ) {
      await this.mailer.send(input.email, { kind: 'registration_attempt' });
      return;
    }
    const accountId = this.ids.next();
    const profileId = this.ids.next();
    const token = this.tokens.generate();
    const result = await this.accounts.create(
      {
        id: accountId,
        email: input.email,
        passwordHash: input.passwordHash,
        ageAttestedAt: now,
        createdAt: now,
        pendingInvitationId: input.invitationId,
        profile: {
          id: profileId,
          displayName: input.displayName.trim(),
          accentColor: accentColorFor(profileId),
          locale: input.locale ?? DEFAULT_LOCALE,
          currency: DEFAULT_CURRENCY,
          timezone: input.timezone ?? DEFAULT_TIMEZONE,
        },
      },
      {
        id: this.ids.next(),
        accountId,
        purpose: 'EMAIL_VERIFY',
        tokenHash: this.tokens.hash(token),
        newEmail: null,
        createdAt: now,
        expiresAt: tokenExpiry('EMAIL_VERIFY', now),
      },
    );
    if (result === 'email_taken') {
      // Inscription concurrente de la même adresse : même traitement qu'une adresse déjà prise.
      await this.mailer.send(input.email, { kind: 'registration_attempt' });
      return;
    }
    await this.securityLog.record({
      accountId,
      event: 'account.registered',
      ip: input.client.ip,
      userAgent: input.client.userAgent,
      at: now,
    });
    await this.mailer.send(input.email, { kind: 'verify_email', token });
  }
}
