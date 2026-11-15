import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { AccountRepository } from '../domain/account.ports';
import { SessionLifecycle } from './session-lifecycle';

/** Marge de la coupure de création : un compte tout juste créé reste « non vérifié ». */
const CUTOFF_MARGIN_MS = 1000;

/**
 * Supprime un compte non vérifié (AUTH-09 : invitation épuisée à la vérification), dans l'ordre de
 * l'ADR 0013 : époque augmentée et compte suspendu dans la même transaction (plus aucune session
 * possible), puis suppression. Un compte vérifié entre-temps n'est pas touché. Renvoie vrai si le
 * compte a été supprimé.
 */
@Injectable()
export class RemoveUnverifiedAccount {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly lifecycle: SessionLifecycle,
    private readonly clock: Clock,
  ) {}

  async execute(accountId: string): Promise<boolean> {
    const cutoff = new Date(this.clock.now().getTime() + CUTOFF_MARGIN_MS);
    const outcome = { suspended: false };
    await this.lifecycle.changeEpoch(accountId, async (authEpoch) => {
      outcome.suspended = await this.accounts.suspendUnverified(accountId, cutoff, authEpoch);
    });
    return outcome.suspended && (await this.accounts.deleteUnverified(accountId));
  }
}
