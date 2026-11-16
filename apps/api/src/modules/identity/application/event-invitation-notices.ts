import { Injectable } from '@nestjs/common';
import { AccountRepository, BackgroundTasks } from '../domain/account.ports';
import { LinkRepository } from '../domain/link.ports';
import { AccountMailer } from './account-mailer';

/**
 * EVT-15 : e-mail neutre au compte de chaque profil invité à un événement, une fois par compte,
 * après la réponse (tâche de fond) et par le quota d'envoi du destinataire. Exposé aux autres
 * modules par `identity/index.ts` : les adresses des comptes ne sortent pas d'`identity`.
 */
@Injectable()
export class EventInvitationNotices {
  constructor(
    private readonly links: LinkRepository,
    private readonly accounts: AccountRepository,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
  ) {}

  notify(profileIds: readonly string[]): void {
    if (profileIds.length === 0) return;
    const ids = [...profileIds];
    this.background.run('event.invitation_mail', async () => {
      const accountIds = new Set<string>();
      for (const id of ids) {
        const party = await this.links.findParty(id);
        if (party) accountIds.add(party.accountId);
      }
      for (const accountId of accountIds) {
        const account = await this.accounts.findById(accountId);
        if (account?.active) await this.mailer.send(account.email, { kind: 'event_invitation' });
      }
    });
  }
}
