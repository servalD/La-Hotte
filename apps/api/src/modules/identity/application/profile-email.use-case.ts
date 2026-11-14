import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import { normalizeEmail } from '../domain/account';
import { AccountTokenInvalidError } from '../domain/account.errors';
import { AccountRepository, BackgroundTasks } from '../domain/account.ports';
import { ChildEmailForbiddenError } from '../domain/link.errors';
import { RateLimiter, SecretTokens } from '../domain/ports';
import { ProfileNotFoundError } from '../domain/profile.errors';
import { ProfileRepository } from '../domain/profile.ports';
import { EmailNotVerifiedError } from '../domain/second-factor.errors';
import { SessionRequiredError } from '../domain/session.errors';
import { PROFILE_EMAIL_VERIFY_TTL_MS } from '../domain/transfer';
import { AccountMailer } from './account-mailer';
import type { ActiveProfile } from './authorize-profile.use-case';
import type { ClientInfo } from './client-info';
import { failToken } from './token-failure';

/**
 * PRO-10 : adresse du profil actif, fixée depuis le profil (PIN validé par la garde), jamais depuis
 * l'espace Compte. Elle n'est écrite qu'à la vérification par le lien envoyé ; refusée à un profil
 * enfant (RGPD-02). La réponse ne dit rien de l'adresse (ni unique ni cherchée : elle peut être
 * celle d'un autre profil ou d'un compte).
 */
@Injectable()
export class SetOwnEmail {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly profiles: ProfileRepository,
    private readonly tokens: SecretTokens,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: { readonly profile: ActiveProfile; readonly email: string }): Promise<void> {
    const account = await this.accounts.findById(input.profile.accountId);
    if (!account) throw new SessionRequiredError();
    if (!account.emailVerified) throw new EmailNotVerifiedError();
    const email = normalizeEmail(input.email);
    const token = this.tokens.generate();
    const now = this.clock.now();
    const result = await this.profiles.requestEmailVerification({
      tokenId: this.ids.next(),
      accountId: input.profile.accountId,
      profileId: input.profile.id,
      email,
      tokenHash: this.tokens.hash(token),
      now,
      expiresAt: new Date(now.getTime() + PROFILE_EMAIL_VERIFY_TTL_MS),
    });
    if (result === 'missing') throw new ProfileNotFoundError();
    if (result === 'child') throw new ChildEmailForbiddenError();
    this.background.run('profile.email_verify_mail', async () => {
      await this.mailer.send(email, { kind: 'verify_profile_email', token });
    });
  }
}

/** PRO-09 : le profil actif a lu la notice du changement de son marqueur enfant. */
@Injectable()
export class ReadChildNotice {
  constructor(private readonly profiles: ProfileRepository) {}

  async execute(profile: ActiveProfile): Promise<void> {
    if (!(await this.profiles.clearChildNotice(profile.accountId, profile.id))) {
      throw new ProfileNotFoundError();
    }
  }
}

/** PRO-10 : le profil actif efface son adresse ; les liens encore ouverts ne servent plus. */
@Injectable()
export class ClearOwnEmail {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly clock: Clock,
  ) {}

  async execute(profile: ActiveProfile): Promise<void> {
    if (!(await this.profiles.clearEmail(profile.accountId, profile.id, this.clock.now()))) {
      throw new ProfileNotFoundError();
    }
  }
}

/**
 * PRO-10 : vérification de l'adresse d'un profil par son lien (route publique, jeton dans le corps,
 * ADR 0013). N'ouvre aucune session. Un seul refus pour tout jeton inutilisable.
 */
@Injectable()
export class VerifyProfileEmail {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly tokens: SecretTokens,
    private readonly limiter: RateLimiter,
    private readonly clock: Clock,
  ) {}

  async execute(input: { readonly token: string; readonly client: ClientInfo }): Promise<void> {
    const confirmed = this.tokens.isWellFormed(input.token)
      ? await this.profiles.confirmEmail(this.tokens.hash(input.token), this.clock.now())
      : null;
    if (!confirmed) {
      await failToken(
        this.limiter,
        input.client.ip,
        this.clock.now(),
        new AccountTokenInvalidError(),
      );
    }
  }
}
