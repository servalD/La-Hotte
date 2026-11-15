import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { UNVERIFIED_ACCOUNT_MAX_AGE_MS } from '../domain/account';
import { AccountRepository } from '../domain/account.ports';
import { INVITATION_RETENTION_MS } from '../domain/link';
import { LinkRepository } from '../domain/link.ports';
import { SecurityLog } from '../domain/ports';
import { SessionLifecycle } from './session-lifecycle';

const BATCH = 100;

/** Adresse et agent d'un événement du système (colonne `ip` obligatoire, SEC-30). */
const SYSTEM_CLIENT = { ip: '0.0.0.0', userAgent: 'system' } as const;

/**
 * AUTH-15 : un compte non vérifié sous 7 jours est supprimé. Ordre de l'ADR 0013 (« Aucune ligne
 * `session` ne disparaît autrement ») : époque augmentée et compte suspendu dans la même
 * transaction (plus aucune session possible), sessions révoquées, puis profils et compte
 * supprimés. Un compte vérifié entre-temps n'est que déconnecté ; s'il reste une session, la
 * suppression échoue (`RESTRICT`) et sera reprise au passage suivant.
 */
@Injectable()
export class PurgeUnverifiedAccounts {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly links: LinkRepository,
    private readonly lifecycle: SessionLifecycle,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  /** Renvoie le nombre de comptes supprimés. */
  async execute(): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - UNVERIFIED_ACCOUNT_MAX_AGE_MS);
    let purged = 0;
    for (const accountId of await this.accounts.findUnverifiedBefore(cutoff, BATCH)) {
      const outcome = { suspended: false };
      await this.lifecycle.changeEpoch(accountId, async (authEpoch) => {
        outcome.suspended = await this.accounts.suspendUnverified(accountId, cutoff, authEpoch);
      });
      if (!outcome.suspended || !(await this.accounts.deleteUnverified(accountId))) continue;
      purged += 1;
      await this.securityLog.record({
        accountId,
        event: 'account.purged',
        ...SYSTEM_CLIENT,
        at: this.clock.now(),
      });
    }
    // LNK-10, RGPD-09 : invitations terminées depuis 30 jours.
    await this.links.purgeInvitations(
      new Date(this.clock.now().getTime() - INVITATION_RETENTION_MS),
    );
    return purged;
  }
}
