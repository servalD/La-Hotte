import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import { type AccountTokenPurpose, normalizeEmail, tokenExpiry } from '../domain/account';
import { AccountRepository, BackgroundTasks } from '../domain/account.ports';
import { SecretTokens, SecurityLog } from '../domain/ports';
import type { ClientInfo } from './client-info';
import { AccountMailer } from './account-mailer';

/**
 * Changement d'e-mail demandé (AUTH-16 ; ré-authentification vérifiée par la garde, AUTH-14).
 * Même réponse que la nouvelle adresse soit libre ou prise : tout se fait après la réponse.
 * - Libre : lien de confirmation (24 heures) envoyé à la nouvelle adresse.
 * - Prise : son titulaire est averti à la place ; rien ne change.
 * Dans les deux cas, l'adresse actuelle est prévenue, avec un lien d'annulation (7 jours) qui la
 * rétablit et révoque toutes les sessions.
 */
@Injectable()
export class RequestEmailChange {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly tokens: SecretTokens,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly securityLog: SecurityLog,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly accountId: string;
    readonly newEmail: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    const newEmail = normalizeEmail(input.newEmail);
    await this.securityLog.record({
      accountId: input.accountId,
      event: 'email.change_requested',
      ip: input.client.ip,
      userAgent: input.client.userAgent,
      at: this.clock.now(),
    });
    this.background.run('email.change_request', () => this.issue(input.accountId, newEmail));
  }

  private async issue(accountId: string, newEmail: string): Promise<void> {
    const account = await this.accounts.findById(accountId);
    if (!account?.active || account.email === newEmail) return;

    // L'adresse actuelle est prévenue d'abord. Si l'avertissement ne part pas (quota du
    // destinataire épuisé, par exemple par un tiers qui a multiplié les demandes), on s'arrête :
    // aucun changement ne peut aboutir sans que l'ancienne adresse ait reçu de quoi l'annuler.
    // L'adresse à rétablir voyage dans le jeton d'annulation (`new_email`, 12).
    const cancel = await this.issueToken(accountId, 'EMAIL_CHANGE_CANCEL', account.email);
    if (!(await this.mailer.send(account.email, { kind: 'email_change_notice', token: cancel }))) {
      return;
    }

    if (
      (await this.accounts.findByEmail(newEmail)) ||
      (await this.accounts.isEmailReserved(newEmail, accountId, this.clock.now()))
    ) {
      await this.mailer.send(newEmail, { kind: 'email_taken_notice' });
      return;
    }
    const token = await this.issueToken(accountId, 'EMAIL_CHANGE', newEmail);
    await this.mailer.send(newEmail, { kind: 'confirm_email_change', token });
  }

  private async issueToken(
    accountId: string,
    purpose: AccountTokenPurpose,
    newEmail: string,
  ): Promise<string> {
    const now = this.clock.now();
    const token = this.tokens.generate();
    await this.accounts.issueToken({
      id: this.ids.next(),
      accountId,
      purpose,
      tokenHash: this.tokens.hash(token),
      newEmail,
      createdAt: now,
      expiresAt: tokenExpiry(purpose, now),
    });
    return token;
  }
}
