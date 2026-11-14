import { Injectable } from '@nestjs/common';
import { GuardianNotices } from './guardian-notices';
import { Clock, IdGenerator } from '../../../shared/domain';
import { AccountTokenInvalidError } from '../domain/account.errors';
import { AccountRepository, IdentitySettings } from '../domain/account.ports';
import { LinkRepository } from '../domain/link.ports';
import { IdentityEvents, SecretTokens, type SecurityEvent, SecurityLog } from '../domain/ports';
import type { ClientInfo } from './client-info';
import { RemoveUnverifiedAccount } from './remove-unverified-account';

/**
 * Lien reçu par e-mail (`POST /auth/email/verify`, jeton dans le corps, ADR 0013) : vérification
 * de l'adresse d'un compte neuf (AUTH-01, AUTH-15), ou confirmation d'un changement d'adresse
 * (AUTH-16). **N'ouvre jamais de session** : le jeton prouve la boîte, pas l'inscription. Qui a
 * reçu le lien d'une inscription faite par un autre ne connaît pas le mot de passe ; il passe par
 * la réinitialisation, qui évince l'auteur (AUTH-06, AUTH-15). Un seul message de refus, quelle
 * qu'en soit la raison (adresse prise ou réservée comprise).
 *
 * Inscription par invitation (AUTH-09, LNK-08) : l'invitation est consommée ici, avec la création
 * du lien et la vérification, dans une seule transaction. Épuisée, elle fait refuser la
 * vérification en `INVITE_ONLY` (message neutre, compte supprimé) et se laisse ignorer en `OPEN`.
 */
@Injectable()
export class VerifyEmail {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly links: LinkRepository,
    private readonly tokens: SecretTokens,
    private readonly removal: RemoveUnverifiedAccount,
    private readonly events: IdentityEvents,
    private readonly settings: IdentitySettings,
    private readonly securityLog: SecurityLog,
    private readonly ids: IdGenerator,
    private readonly guardianNotices: GuardianNotices,
    private readonly clock: Clock,
  ) {}

  async execute(input: { readonly token: string; readonly client: ClientInfo }): Promise<void> {
    if (!this.tokens.isWellFormed(input.token)) throw new AccountTokenInvalidError();
    const now = this.clock.now();
    const consumed = await this.accounts.consumeToken(
      this.tokens.hash(input.token),
      ['EMAIL_VERIFY', 'EMAIL_CHANGE'],
      now,
    );
    if (!consumed) throw new AccountTokenInvalidError();

    if (consumed.purpose === 'EMAIL_CHANGE') {
      if (!consumed.newEmail) throw new AccountTokenInvalidError();
      if (!(await this.accounts.changeEmail(consumed.accountId, consumed.newEmail, now))) {
        throw new AccountTokenInvalidError();
      }
      await this.log(consumed.accountId, 'email.changed', input.client);
      this.guardianNotices.notify(consumed.accountId, 'email');
      return;
    }

    const linkId = this.ids.next();
    const invitation = await this.links.consumePendingInvitation({
      accountId: consumed.accountId,
      linkId,
      now,
    });
    // `none` compte aussi : l'invitation a disparu depuis l'inscription (profil de l'invitant supprimé).
    if (
      (invitation === 'exhausted' || invitation === 'none') &&
      this.settings.registrationMode === 'INVITE_ONLY'
    ) {
      if (await this.removal.execute(consumed.accountId)) {
        await this.log(consumed.accountId, 'account.purged', input.client);
      }
      throw new AccountTokenInvalidError();
    }
    // `linked` a déjà vérifié l'adresse, dans la transaction de l'invitation.
    if (invitation !== 'linked') await this.accounts.markEmailVerified(consumed.accountId, now);
    await this.log(consumed.accountId, 'email.verified', input.client);
    if (invitation === 'linked') {
      await this.log(consumed.accountId, 'link.created', input.client);
      const link = await this.links.findLink(linkId);
      if (link) this.events.publish({ type: 'circle.changed', profileIds: [link.a.id, link.b.id] });
    }
  }

  private async log(accountId: string, event: SecurityEvent, client: ClientInfo): Promise<void> {
    await this.securityLog.record({
      accountId,
      event,
      ip: client.ip,
      userAgent: client.userAgent,
      at: this.clock.now(),
    });
  }
}
