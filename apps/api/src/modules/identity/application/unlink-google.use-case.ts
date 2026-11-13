import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { AccountRepository, BackgroundTasks } from '../domain/account.ports';
import { GoogleNotLinkedError, GooglePasswordRequiredError } from '../domain/google.errors';
import { GoogleIdentityRepository } from '../domain/google.ports';
import { SecurityLog, type SessionRef } from '../domain/ports';
import { SessionRequiredError } from '../domain/session.errors';
import { AccountMailer } from './account-mailer';
import type { ClientInfo } from './client-info';
import { type IssuedSession, SessionLifecycle } from './session-lifecycle';

/**
 * Dissociation de Google (AUTH-03, AUTH-05 ; AUTH-14 : ré-authentification vérifiée par la garde).
 * Seulement avec un mot de passe, sinon le compte n'aurait plus de moyen de connexion. Comme une
 * désactivation du TOTP : l'époque augmente (ADR 0014), toutes les sessions tombent, y compris
 * celles ouvertes par Google, puis une session neuve est ouverte pour l'appelant.
 *
 * Les conditions sont vérifiées avant le changement d'époque (un refus ne déconnecte personne),
 * puis de nouveau dans la transaction.
 */
@Injectable()
export class UnlinkGoogle {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly identities: GoogleIdentityRepository,
    private readonly lifecycle: SessionLifecycle,
    private readonly securityLog: SecurityLog,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly session: SessionRef;
    readonly client: ClientInfo;
  }): Promise<IssuedSession> {
    const accountId = input.session.accountId;
    const account = await this.accounts.findById(accountId);
    if (!account) throw new SessionRequiredError();
    if ((await this.identities.findSubject(accountId)) === null) throw new GoogleNotLinkedError();
    if (account.passwordHash === null) throw new GooglePasswordRequiredError();

    const outcome = { result: 'not_linked' as 'unlinked' | 'not_linked' | 'no_password' };
    const epoch = await this.lifecycle.changeEpoch(accountId, async (authEpoch) => {
      outcome.result = await this.identities.unlink(accountId, authEpoch);
    });
    if (outcome.result === 'no_password') throw new GooglePasswordRequiredError();
    if (outcome.result === 'not_linked') throw new GoogleNotLinkedError();

    await this.securityLog.record({
      accountId,
      event: 'google.unlinked',
      ip: input.client.ip,
      userAgent: input.client.userAgent,
      at: this.clock.now(),
    });
    this.background.run('google.unlinked_notice', async () => {
      const current = await this.accounts.findById(accountId);
      if (current) await this.mailer.send(current.email, { kind: 'google_unlinked' });
    });
    // L'ancienne session est déjà révoquée par `changeEpoch` ; pas de `previous`.
    return this.lifecycle.create({
      accountId,
      observedEpoch: epoch,
      userAgent: input.client.userAgent,
    });
  }
}
