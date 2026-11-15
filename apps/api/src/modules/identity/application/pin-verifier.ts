import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { AccountRepository, BackgroundTasks, PasswordHasher } from '../domain/account.ports';
import { SecurityLog } from '../domain/ports';
import { PIN_FAILURE_THRESHOLD } from '../domain/profile';
import {
  PinInvalidError,
  PinRateLimitedError,
  ProfileNotFoundError,
} from '../domain/profile.errors';
import { ProfileRepository } from '../domain/profile.ports';
import { AccountMailer } from './account-mailer';
import type { ClientInfo } from './client-info';

/**
 * Issue d'une vérification : le profil n'a pas de PIN, ou le PIN est juste. `pinStamp` : empreinte
 * du hash vérifié, calculée par l'adaptateur, portée par le déverrouillage (PIN-05).
 */
export type PinCheck =
  | { readonly kind: 'no_pin' }
  | { readonly kind: 'verified'; readonly pinHash: string; readonly pinStamp: string };

/**
 * Vérification d'un PIN (PIN-02, PIN-03), commune à la sélection d'un profil et au changement de
 * PIN. L'essai est compté **avant** d'être évalué ; pendant l'attente, il est refusé sans être
 * évalué. À chaque attente posée, une ligne `pin.locked` au journal ; à la 5ᵉ erreur, un e-mail au
 * compte (après la réponse, par le quota d'envoi). Le PIN n'est jamais journalisé.
 */
@Injectable()
export class PinVerifier {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly hasher: PasswordHasher,
    private readonly accounts: AccountRepository,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async verify(input: {
    readonly accountId: string;
    readonly profileId: string;
    readonly pin: string;
    readonly client: ClientInfo;
  }): Promise<PinCheck> {
    const now = this.clock.now();
    const attempt = await this.profiles.countPinAttempt(input.accountId, input.profileId, now);
    if (!attempt) throw new ProfileNotFoundError();
    if (attempt.kind === 'no_pin') return { kind: 'no_pin' };
    if (attempt.kind === 'locked') throw new PinRateLimitedError(attempt.retryAfterMs);

    if (await this.hasher.verify(attempt.pinHash, input.pin)) {
      // Un PIN réinitialisé pendant la vérification ne déverrouille pas : l'essai reste compté.
      if (
        !(await this.profiles.recordPinSuccess(input.accountId, input.profileId, attempt.pinHash))
      ) {
        throw new PinInvalidError();
      }
      return { kind: 'verified', pinHash: attempt.pinHash, pinStamp: attempt.pinStamp };
    }

    if (attempt.failures >= PIN_FAILURE_THRESHOLD) {
      await this.securityLog.record({
        accountId: input.accountId,
        event: 'pin.locked',
        ip: input.client.ip,
        userAgent: input.client.userAgent,
        at: now,
      });
      if (attempt.failures === PIN_FAILURE_THRESHOLD) this.warnAccount(input.accountId);
    }
    throw new PinInvalidError();
  }

  /** PIN-03 : les autres profils du compte sont prévenus, par l'adresse du compte (phase 4 : notification). */
  private warnAccount(accountId: string): void {
    this.background.run('pin.attempts_notice', async () => {
      const account = await this.accounts.findById(accountId);
      if (account?.active) await this.mailer.send(account.email, { kind: 'pin_attempts' });
    });
  }
}
