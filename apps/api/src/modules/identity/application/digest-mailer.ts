import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { AccountRepository } from '../domain/account.ports';
import { SessionStore } from '../domain/ports';
import { rejectSession } from '../domain/session';
import { AccountMailer } from './account-mailer';

/**
 * NOT-17 : résumé e-mail à l'adresse du compte, exposé au module `notifications` par
 * `identity/index.ts` (les adresses ne sortent pas d'`identity`). Quota par destinataire comme
 * tout e-mail du compte.
 */
@Injectable()
export class DigestMailer {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly mailer: AccountMailer,
  ) {}

  async send(
    accountId: string,
    entries: readonly { readonly profileName: string; readonly count: number }[],
  ): Promise<boolean> {
    if (entries.length === 0) return false;
    const account = await this.accounts.findById(accountId);
    if (!account?.active) return false;
    return this.mailer.send(account.email, { kind: 'digest', entries });
  }
}

/**
 * NOT-15 : une session est-elle encore vivante (quel que soit son profil actif) ? Une push ne part
 * vers l'appareil d'une session que si elle l'est.
 */
@Injectable()
export class CheckSessionAlive {
  constructor(
    private readonly store: SessionStore,
    private readonly clock: Clock,
  ) {}

  async execute(sessionId: string): Promise<boolean> {
    const found = await this.store.findById(sessionId);
    return found !== null && !rejectSession(found.record, found.accountEpoch, this.clock.now());
  }
}
