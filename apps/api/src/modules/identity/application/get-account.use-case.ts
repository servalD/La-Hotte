import { Injectable } from '@nestjs/common';
import { SessionStore } from '../domain/ports';
import type { AccountRole } from '../domain/session';
import { AccountRepository } from '../domain/account.ports';
import { GoogleIdentityRepository } from '../domain/google.ports';
import { SecondFactorRepository } from '../domain/second-factor.ports';
import { SessionRequiredError } from '../domain/session.errors';

/** Métadonnées du compte (PIN-08, ADR 0013) : jamais un contenu de profil. */
export interface AccountSummary {
  readonly email: string;
  readonly emailVerified: boolean;
  readonly hasPassword: boolean;
  readonly googleLinked: boolean;
  readonly totpEnabled: boolean;
  readonly recoveryCodesRemaining: number;
  /** RBAC-01 : rôle de plateforme, pour montrer l'accès à l'espace d'administration. */
  readonly role: AccountRole;
}

/** `GET /account` : de quoi afficher l'espace Compte et savoir si la ré-authentification demande un code. */
@Injectable()
export class GetAccount {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly secondFactors: SecondFactorRepository,
    private readonly identities: GoogleIdentityRepository,
    private readonly sessions: SessionStore,
  ) {}

  async execute(accountId: string): Promise<AccountSummary> {
    const [account, state] = await Promise.all([
      this.accounts.findById(accountId),
      this.sessions.accountState(accountId),
    ]);
    if (!account || !state) throw new SessionRequiredError();
    return {
      email: account.email,
      emailVerified: account.emailVerified,
      hasPassword: account.passwordHash !== null,
      googleLinked: (await this.identities.findSubject(accountId)) !== null,
      totpEnabled: account.totpEnabled,
      recoveryCodesRemaining: account.totpEnabled
        ? await this.secondFactors.countUnusedRecoveryCodes(accountId)
        : 0,
      role: state.role,
    };
  }
}
