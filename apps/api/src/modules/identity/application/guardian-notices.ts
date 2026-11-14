import { Injectable } from '@nestjs/common';
import { BackgroundTasks } from '../domain/account.ports';
import { WardRepository } from '../domain/ward.ports';
import { AccountMailer, type WardChange } from './account-mailer';

/**
 * PRO-16 : le tuteur est averti des changements d'adresse, de mot de passe et de TOTP d'un compte
 * sous sa tutelle. En tâche de fond, après la réponse ; sans effet pour un compte qui n'est pas
 * sous tutelle.
 */
@Injectable()
export class GuardianNotices {
  constructor(
    private readonly wards: WardRepository,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
  ) {}

  notify(accountId: string, change: WardChange): void {
    this.background.run('ward.change_notice', async () => {
      const guardianship = await this.wards.guardianshipOf(accountId);
      if (guardianship) {
        await this.mailer.send(guardianship.guardianEmail, {
          kind: 'ward_account_changed',
          change,
        });
      }
    });
  }
}
