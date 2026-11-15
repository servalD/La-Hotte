import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import { tokenExpiry } from '../domain/account';
import { AccountTokenInvalidError } from '../domain/account.errors';
import { AccountRepository, BackgroundTasks } from '../domain/account.ports';
import { SecretTokens, SecurityLog } from '../domain/ports';
import { AccountMailer } from './account-mailer';
import type { ClientInfo } from './client-info';
import { SessionLifecycle } from './session-lifecycle';

/**
 * Annulation d'un changement d'e-mail depuis l'ancienne adresse (AUTH-16). Par l'époque du compte
 * (ADR 0014), toutes les sessions tombent. Dans la même transaction :
 * - le mot de passe est effacé, puisque l'auteur du changement le connaît ;
 * - les liens envoyés pendant le détournement sont désarmés (vérification, confirmation,
 *   réinitialisation, et les liens d'annulation émis **après** celui-ci, qui rétabliraient
 *   l'adresse de l'auteur) ;
 * - l'ancienne adresse est rétablie si elle est libre (elle est réservée tant que ce lien est
 *   ouvert).
 * Un lien de réinitialisation part ensuite vers l'adresse rétablie, et seulement vers elle.
 */
@Injectable()
export class CancelEmailChange {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly tokens: SecretTokens,
    private readonly lifecycle: SessionLifecycle,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly securityLog: SecurityLog,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: { readonly token: string; readonly client: ClientInfo }): Promise<void> {
    if (!this.tokens.isWellFormed(input.token)) throw new AccountTokenInvalidError();
    const tokenHash = this.tokens.hash(input.token);
    // Lu sans être consommé : la consommation se fait dans la transaction du rétablissement, pour
    // que l'annulation soit tout ou rien (une panne ne brûle pas le lien).
    const open = await this.accounts.findOpenToken(
      tokenHash,
      ['EMAIL_CHANGE_CANCEL'],
      this.clock.now(),
    );
    if (!open?.newEmail) throw new AccountTokenInvalidError();
    const { accountId } = open;

    // Les sessions tombent dès l'étape E+1 (ADR 0014), même si le rétablissement échoue ensuite :
    // seul le détenteur d'un lien valable peut le provoquer.
    const outcome: { result: Awaited<ReturnType<AccountRepository['restoreEmail']>> } = {
      result: { status: 'invalid' },
    };
    await this.lifecycle.changeEpoch(accountId, async (authEpoch) => {
      outcome.result = await this.accounts.restoreEmail({
        tokenHash,
        accountId,
        authEpoch,
        now: this.clock.now(),
      });
    });
    const { result } = outcome;
    if (result.status !== 'restored') throw new AccountTokenInvalidError();

    await this.securityLog.record({
      accountId,
      event: 'email.change_cancelled',
      ip: input.client.ip,
      userAgent: input.client.userAgent,
      at: this.clock.now(),
    });
    const email = result.email;
    this.background.run('email.change_cancel_reset', () => this.sendReset(accountId, email));
  }

  private async sendReset(accountId: string, email: string): Promise<void> {
    const now = this.clock.now();
    const token = this.tokens.generate();
    await this.accounts.issueToken({
      id: this.ids.next(),
      accountId,
      purpose: 'PASSWORD_RESET',
      tokenHash: this.tokens.hash(token),
      newEmail: null,
      createdAt: now,
      expiresAt: tokenExpiry('PASSWORD_RESET', now),
    });
    await this.mailer.send(email, { kind: 'reset_password', token });
  }
}
