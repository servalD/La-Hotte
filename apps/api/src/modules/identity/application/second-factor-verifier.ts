import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { AccountRepository, BackgroundTasks } from '../domain/account.ports';
import { EventThrottle, SecretTokens } from '../domain/ports';
import { RATE_LIMIT_POLICIES } from '../domain/rate-limit';
import {
  formatRecoveryCode,
  RECOVERY_CODE_COUNT,
  type SecondFactorCode,
} from '../domain/second-factor';
import { SecondFactorRepository, SecretCipher, TotpEngine } from '../domain/second-factor.ports';
import { AccountMailer } from './account-mailer';

/** Contexte lié au chiffré du secret (données authentifiées) : il appartient à ce compte. */
export function totpCipherContext(accountId: string): string {
  return `totp:${accountId}`;
}

/**
 * Vérification d'un code du second facteur, commune à la connexion, à la ré-authentification et
 * aux actions de l'espace Compte (AUTH-10, AUTH-11, AUTH-14). Ne compte rien : la limitation est
 * l'affaire de l'appelant.
 */
@Injectable()
export class SecondFactorVerifier {
  constructor(
    private readonly secondFactors: SecondFactorRepository,
    private readonly cipher: SecretCipher,
    private readonly totp: TotpEngine,
    private readonly tokens: SecretTokens,
    private readonly accounts: AccountRepository,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly throttle: EventThrottle,
    private readonly clock: Clock,
  ) {}

  /**
   * Échec du second facteur compté (`failures` : échecs dans la fenêtre, celui-ci compris). Au
   * premier franchissement du seuil dans la fenêtre, le titulaire est averti par e-mail : des codes
   * faux après un mot de passe juste disent qu'un tiers le connaît (AUTH-07, revue SEC-40 de la
   * tranche 3, I1).
   */
  async noteFailures(accountId: string, failures: number): Promise<void> {
    const { threshold, windowMs } = RATE_LIMIT_POLICIES.second_factor;
    if (failures < threshold) return;
    if (!(await this.throttle.firstInWindow(['second_factor_alert', accountId], windowMs))) return;
    this.background.run('second_factor.attempts_notice', async () => {
      const account = await this.accounts.findById(accountId);
      if (account) await this.mailer.send(account.email, { kind: 'second_factor_attempts' });
    });
  }

  /**
   * Code accepté et consommé : un code TOTP par son pas de temps (AUTH-11), un code de secours
   * par son usage unique. `null` si le TOTP n'est pas actif ou si le code est refusé.
   */
  async verify(accountId: string, code: SecondFactorCode): Promise<'totp' | 'recovery' | null> {
    if (code.kind === 'recovery') {
      const used = await this.secondFactors.consumeRecoveryCode(
        accountId,
        this.tokens.hash(code.code),
        this.clock.now(),
      );
      if (!used) return null;
      // Avis au compte, après la réponse : un code de secours volé ne sert pas en silence.
      this.background.run('recovery.code_used_notice', async () => {
        const account = await this.accounts.findById(accountId);
        if (account) await this.mailer.send(account.email, { kind: 'recovery_code_used' });
      });
      return 'recovery';
    }
    const state = await this.secondFactors.findTotp(accountId);
    if (!state?.enabled || !state.secretEnc) return null;
    const step = await this.totp.verify({
      secret: this.cipher.decrypt(state.secretEnc, totpCipherContext(accountId)),
      code: code.code,
      now: this.clock.now(),
      afterStep: state.lastStep,
    });
    // Le dépôt revérifie atomiquement : deux requêtes concurrentes au même code, une seule passe.
    if (step === null || !(await this.secondFactors.consumeStep(accountId, step))) return null;
    return 'totp';
  }

  /** AUTH-10 : 10 codes, affichés une fois (forme groupée), stockés en SHA-256 (SEC-22). */
  newRecoveryCodes(): { readonly codes: string[]; readonly hashes: string[] } {
    const raw = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      this.tokens.generateRecoveryCode(),
    );
    return {
      codes: raw.map(formatRecoveryCode),
      hashes: raw.map((code) => this.tokens.hash(code)),
    };
  }
}
