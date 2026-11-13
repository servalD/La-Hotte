import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { AccountRepository, BackgroundTasks } from '../domain/account.ports';
import { RateLimiter, SecurityLog } from '../domain/ports';
import { normalizeTotpCode } from '../domain/second-factor';
import {
  EmailNotVerifiedError,
  InvalidSecondFactorError,
  TotpAlreadyEnabledError,
  TotpEnrollmentMissingError,
} from '../domain/second-factor.errors';
import { SecondFactorRepository, SecretCipher, TotpEngine } from '../domain/second-factor.ports';
import { RateLimitedError, SessionRequiredError } from '../domain/session.errors';
import { AccountMailer } from './account-mailer';
import type { ClientInfo } from './client-info';
import { SecondFactorVerifier, totpCipherContext } from './second-factor-verifier';
import { type IssuedSession, SessionLifecycle } from './session-lifecycle';

/**
 * Inscription au TOTP (AUTH-10, AUTH-11, AUTH-15 ; ré-authentification vérifiée par la garde,
 * AUTH-14). Le secret est tiré par le serveur, chiffré (SEC-22), et renvoyé une seule fois pour le
 * QR code. Une nouvelle inscription remplace celle qui n'a pas été confirmée.
 */
@Injectable()
export class StartTotpEnrollment {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly secondFactors: SecondFactorRepository,
    private readonly cipher: SecretCipher,
    private readonly totp: TotpEngine,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly accountId: string;
    readonly client: ClientInfo;
  }): Promise<{ readonly secret: string; readonly otpauthUri: string }> {
    const account = await this.accounts.findById(input.accountId);
    if (!account) throw new SessionRequiredError();
    if (!account.emailVerified) throw new EmailNotVerifiedError();
    if (account.totpEnabled) throw new TotpAlreadyEnabledError();

    const secret = this.totp.generateSecret();
    const secretEnc = this.cipher.encrypt(secret, totpCipherContext(input.accountId));
    if (!(await this.secondFactors.startEnrollment(input.accountId, secretEnc, this.clock.now()))) {
      throw new TotpAlreadyEnabledError();
    }
    await this.securityLog.record({
      accountId: input.accountId,
      event: 'totp.enrollment_started',
      ip: input.client.ip,
      userAgent: input.client.userAgent,
      at: this.clock.now(),
    });
    return { secret, otpauthUri: this.totp.uri({ label: account.email, secret }) };
  }
}

/**
 * Confirmation de l'inscription par un code valide (AUTH-10) : TOTP actif, pas noté (AUTH-11),
 * 10 codes de secours renvoyés une seule fois. Les codes faux comptent sur le compteur du second
 * facteur. Toutes les sessions tombent (AUTH-05) ; l'appelant en reçoit une neuve.
 */
@Injectable()
export class ActivateTotp {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly secondFactors: SecondFactorRepository,
    private readonly verifier: SecondFactorVerifier,
    private readonly cipher: SecretCipher,
    private readonly totp: TotpEngine,
    private readonly limiter: RateLimiter,
    private readonly securityLog: SecurityLog,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly lifecycle: SessionLifecycle,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly accountId: string;
    readonly code: string;
    readonly client: ClientInfo;
  }): Promise<{ readonly recoveryCodes: string[]; readonly issued: IssuedSession }> {
    const { accountId } = input;
    const state = await this.secondFactors.findTotp(accountId);
    if (!state) throw new SessionRequiredError();
    if (state.enabled) throw new TotpAlreadyEnabledError();
    if (!state.secretEnc) throw new TotpEnrollmentMissingError();
    const secretEnc = state.secretEnc;

    const subjects = [{ scope: 'second_factor' as const, parts: [accountId] }];
    const check = await this.limiter.check(subjects, this.clock.now());
    if (!check.allowed || !check.reservation) throw new RateLimitedError(check.retryAfterMs);

    const code = normalizeTotpCode(input.code);
    const step = code
      ? await this.totp.verify({
          secret: this.cipher.decrypt(secretEnc, totpCipherContext(accountId)),
          code,
          now: this.clock.now(),
          afterStep: null,
        })
      : null;
    if (step === null) {
      await this.limiter.recordFailure(subjects, this.clock.now(), check.reservation);
      await this.log(accountId, 'totp.failed', input.client);
      throw new InvalidSecondFactorError();
    }
    await this.limiter.recordSuccess(subjects, check.reservation);

    // Inscription remplacée dans un autre onglet : refus avant de toucher à l'époque, pour ne
    // déconnecter personne pour rien. La transaction le revérifie (fenêtre de quelques ms).
    const current = await this.secondFactors.findTotp(accountId);
    // Double envoi (double clic) : le premier a déjà activé ; le second ne doit pas déconnecter
    // la session neuve qu'il a rendue (revue du cycle 2, N1).
    if (current?.enabled) throw new TotpAlreadyEnabledError();
    if (!current?.secretEnc || !sameBytes(current.secretEnc, secretEnc)) {
      throw new TotpEnrollmentMissingError();
    }

    const { codes, hashes } = this.verifier.newRecoveryCodes();
    // AUTH-05, AUTH-10 (revue SEC-40 de la tranche 3, I2) : activer le TOTP déconnecte partout,
    // pour qu'une session ouverte par un tiers qui connaissait le mot de passe ne survive pas.
    // Époque augmentée (ADR 0014) dans la transaction d'activation, puis session neuve.
    const epoch = await this.lifecycle.changeEpoch(accountId, async (authEpoch) => {
      const activated = await this.secondFactors.activate({
        accountId,
        secretEnc,
        step,
        recoveryCodeHashes: hashes,
        authEpoch,
        now: this.clock.now(),
      });
      // Inscription remplacée entre-temps (autre onglet) : ce code ne prouve rien du nouveau
      // secret. Rien n'est écrit ; les sessions sont déjà tombées à l'étape E+1 (ADR 0014).
      if (!activated) throw new TotpEnrollmentMissingError();
    });

    await this.log(accountId, 'totp.enabled', input.client);
    this.background.run('totp.enabled_notice', async () => {
      const account = await this.accounts.findById(accountId);
      if (account) await this.mailer.send(account.email, { kind: 'totp_enabled' });
    });
    const issued = await this.lifecycle.create({
      accountId,
      observedEpoch: epoch,
      userAgent: input.client.userAgent,
    });
    return { recoveryCodes: codes, issued };
  }

  private async log(
    accountId: string,
    event: 'totp.failed' | 'totp.enabled',
    client: ClientInfo,
  ): Promise<void> {
    await this.securityLog.record({
      accountId,
      event,
      ip: client.ip,
      userAgent: client.userAgent,
      at: this.clock.now(),
    });
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
