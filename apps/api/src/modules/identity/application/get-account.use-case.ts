import { Injectable } from '@nestjs/common';
import { AccountRepository } from '../domain/account.ports';
import { SecondFactorRepository } from '../domain/second-factor.ports';
import { SessionRequiredError } from '../domain/session.errors';

/** Métadonnées du compte (PIN-08, ADR 0013) : jamais un contenu de profil. */
export interface AccountSummary {
  readonly email: string;
  readonly emailVerified: boolean;
  readonly hasPassword: boolean;
  readonly totpEnabled: boolean;
  readonly recoveryCodesRemaining: number;
}

/** `GET /account` : de quoi afficher l'espace Compte et savoir si la ré-authentification demande un code. */
@Injectable()
export class GetAccount {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly secondFactors: SecondFactorRepository,
  ) {}

  async execute(accountId: string): Promise<AccountSummary> {
    const account = await this.accounts.findById(accountId);
    if (!account) throw new SessionRequiredError();
    return {
      email: account.email,
      emailVerified: account.emailVerified,
      hasPassword: account.passwordHash !== null,
      totpEnabled: account.totpEnabled,
      recoveryCodesRemaining: account.totpEnabled
        ? await this.secondFactors.countUnusedRecoveryCodes(accountId)
        : 0,
    };
  }
}
