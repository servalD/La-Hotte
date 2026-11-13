import type {
  AccountCredentials,
  AccountTokenPurpose,
  ConsumedAccountToken,
  NewAccount,
  NewAccountToken,
  RegistrationMode,
} from './account';

/**
 * Comptes en base (PostgreSQL). Chaque méthode qui modifie l'état est une transaction ; celles qui
 * écrivent `authEpoch` le font avec `GREATEST` (ADR 0014), jamais en arrière.
 */
export abstract class AccountRepository {
  abstract findByEmail(email: string): Promise<AccountCredentials | null>;
  abstract findById(accountId: string): Promise<AccountCredentials | null>;

  /**
   * Compte, premier profil (PRO-01) et jeton de vérification, ensemble. `email_taken` si
   * l'adresse est prise, y compris par une inscription concurrente.
   */
  abstract create(
    account: NewAccount,
    verifyToken: NewAccountToken,
  ): Promise<'created' | 'email_taken'>;

  /**
   * Nouveau jeton ; les jetons non utilisés du même compte et du même usage sont invalidés, sauf
   * pour `EMAIL_CHANGE_CANCEL` : une nouvelle demande de changement ne doit pas désarmer le lien
   * d'annulation déjà reçu par l'ancienne adresse (AUTH-16).
   */
  abstract issueToken(token: NewAccountToken): Promise<void>;

  /**
   * Usage unique, atomique : le jeton est marqué utilisé s'il est inconnu de personne d'autre,
   * non expiré, d'un des usages attendus et d'un compte actif. `null` sinon.
   */
  abstract consumeToken(
    tokenHash: string,
    purposes: readonly AccountTokenPurpose[],
    now: Date,
  ): Promise<ConsumedAccountToken | null>;

  /** Jeton ouvert (mêmes conditions que `consumeToken`), lu sans être consommé. */
  abstract findOpenToken(
    tokenHash: string,
    purposes: readonly AccountTokenPurpose[],
    now: Date,
  ): Promise<ConsumedAccountToken | null>;

  abstract markEmailVerified(accountId: string, now: Date): Promise<void>;

  /**
   * Nouveau mot de passe et époque (ADR 0014), dans une transaction. `reset` (AUTH-06) : e-mail
   * marqué vérifié, appareils de confiance révoqués, autres jetons de réinitialisation invalidés.
   */
  abstract setPassword(input: {
    readonly accountId: string;
    readonly passwordHash: string;
    readonly authEpoch: number;
    readonly reset: boolean;
    readonly now: Date;
  }): Promise<void>;

  /**
   * AUTH-16 : adresse réservée par un lien d'annulation ouvert d'un **autre** compte que
   * `exceptAccountId`. Une inscription ou un changement vers elle est traité comme si elle était
   * prise.
   */
  abstract isEmailReserved(
    email: string,
    exceptAccountId: string | null,
    now: Date,
  ): Promise<boolean>;

  /**
   * AUTH-16, confirmation : adresse remplacée et vérifiée, jetons `EMAIL_VERIFY` et `EMAIL_CHANGE`
   * encore ouverts invalidés. Faux si l'adresse est prise ou réservée par un autre compte.
   */
  abstract changeEmail(accountId: string, newEmail: string, now: Date): Promise<boolean>;

  /**
   * AUTH-16, annulation, **tout ou rien** dans une seule transaction : le jeton
   * `EMAIL_CHANGE_CANCEL` est consommé, l'adresse qu'il porte rétablie, l'époque écrite, le mot de
   * passe effacé, les jetons `EMAIL_VERIFY`, `EMAIL_CHANGE`, `PASSWORD_RESET` ouverts désarmés,
   * ainsi que les `EMAIL_CHANGE_CANCEL` émis après celui-ci.
   * - `restored` : tout est fait ; renvoie l'adresse rétablie.
   * - `invalid` : jeton déjà utilisé, expiré ou d'un autre compte ; rien n'est écrit.
   * - `taken` : l'adresse n'est plus libre ; rien n'est écrit, le jeton reste utilisable.
   */
  abstract restoreEmail(input: {
    readonly tokenHash: string;
    readonly accountId: string;
    readonly authEpoch: number;
    readonly now: Date;
  }): Promise<
    | { readonly status: 'restored'; readonly email: string }
    | { readonly status: 'invalid' | 'taken' }
  >;

  /** AUTH-15 : comptes non vérifiés créés avant `cutoff`, du plus ancien au plus récent. */
  abstract findUnverifiedBefore(cutoff: Date, limit: number): Promise<string[]>;

  /**
   * AUTH-15, purge, étape 1 : époque écrite, et compte suspendu (plus aucune session possible)
   * s'il est toujours non vérifié et créé avant `cutoff`. Faux s'il ne l'est plus.
   */
  abstract suspendUnverified(accountId: string, cutoff: Date, authEpoch: number): Promise<boolean>;

  /**
   * AUTH-15, purge, dernière étape : profils et compte supprimés s'il est toujours non vérifié et
   * suspendu. Échoue si une session subsiste (`session.account_id` en `RESTRICT`, ADR 0013).
   */
  abstract deleteUnverified(accountId: string): Promise<boolean>;
}

/** AUTH-02 : argon2id. */
export abstract class PasswordHasher {
  abstract hash(password: string): Promise<string>;
  /**
   * Sans hash (compte absent ou sans mot de passe), une vérification factice de même coût est
   * faite, puis faux (ADR 0013, « Anti-énumération »).
   */
  abstract verify(hash: string | null, password: string): Promise<boolean>;
}

/** AUTH-02 : fuites connues, par k-anonymat. */
export abstract class PasswordBreachChecker {
  /** Vrai si le mot de passe figure dans une fuite ; faux aussi si le service ne répond pas. */
  abstract isBreached(password: string): Promise<boolean>;
}

/**
 * Travail fait après la réponse (ADR 0013 : « l'envoi d'e-mail est mis en file ou fait après la
 * réponse, pour que sa durée ne trahisse rien »). Une tâche qui échoue est signalée sans son
 * contenu ; elle ne change pas la réponse déjà faite.
 */
export abstract class BackgroundTasks {
  abstract run(name: string, task: () => Promise<void>): void;
}

/** Réglages du module lus dans l'environnement. */
export abstract class IdentitySettings {
  /** AUTH-09. */
  abstract readonly registrationMode: RegistrationMode;
  /** Origine de l'application web : base des liens envoyés par e-mail. */
  abstract readonly webOrigin: string;
}
