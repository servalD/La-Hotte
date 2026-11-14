import type { NewProfile } from './account';
import type { GoogleClaims, GoogleReauthProof, OidcFlow } from './google';

/**
 * Fournisseur OpenID Connect Google (ADR 0003 : `openid-client`, code + PKCE). L'adaptateur vérifie
 * `iss`, `aud`, `nonce`, `state`, l'expiration du jeton d'identité, la preuve PKCE et, pour une
 * ré-authentification, la fraîcheur (`auth_time`). Aucun jeton de Google n'est conservé.
 */
export abstract class GoogleOidc {
  /** Faux si le serveur n'est pas configuré pour Google. */
  abstract readonly enabled: boolean;

  /** URL de Google vers laquelle le client navigue. `fresh` : authentification exigée (AUTH-14). */
  abstract authorizationUrl(input: {
    readonly state: string;
    readonly nonce: string;
    readonly codeVerifier: string;
    readonly fresh: boolean;
  }): Promise<string>;

  /**
   * Échange du code contre le jeton d'identité, et affirmations retenues. `callbackQuery` : chaîne
   * de requête du retour, telle que reçue. Lève `GoogleRejectedError` pour toute réponse invalide,
   * `IdentityUnavailableError` si Google ne répond pas.
   */
  abstract exchange(input: {
    readonly callbackQuery: string;
    readonly state: string;
    readonly nonce: string;
    readonly codeVerifier: string;
    readonly fresh: boolean;
  }): Promise<GoogleClaims>;
}

/**
 * Parcours en cours (ADR 0013) : **Redis seul**, 10 minutes, clé dérivée du hash de `state`.
 * `consume` lit et supprime atomiquement : un `state` ne sert qu'une fois. Panne :
 * `IdentityUnavailableError`.
 */
export abstract class OidcFlows {
  abstract create(stateHash: string, flow: OidcFlow, ttlMs: number): Promise<void>;
  abstract consume(stateHash: string): Promise<OidcFlow | null>;
}

/** AUTH-14 : retour de Google en attente du code TOTP, par session, 5 minutes, Redis seul. */
export abstract class GoogleReauthProofs {
  abstract create(sessionId: string, proof: GoogleReauthProof, ttlMs: number): Promise<void>;
  /** Lecture sans suppression : un code mal tapé ne fait pas recommencer le passage par Google. */
  abstract find(sessionId: string): Promise<GoogleReauthProof | null>;
  /** Lecture et suppression atomiques : une seule ré-authentification en sort. */
  abstract consume(sessionId: string): Promise<GoogleReauthProof | null>;
}

/** Compte créé par Google (AUTH-03) : adresse vérifiée, sans mot de passe. */
export interface NewGoogleAccount {
  readonly id: string;
  readonly email: string;
  readonly subject: string;
  readonly identityId: string;
  /** AUTH-08 : déclaration « 15 ans ou plus » faite avant le départ vers Google. */
  readonly ageAttestedAt: Date;
  readonly createdAt: Date;
  readonly profile: NewProfile;
  /** AUTH-09, LNK-08 : invitation à consommer tout de suite après la création. */
  readonly pendingInvitationId?: string | null;
}

/** Identités Google en base (`auth_identity`, AUTH-03). */
export abstract class GoogleIdentityRepository {
  /** Compte associé à cet identifiant Google ; `null` sinon. */
  abstract findAccountBySubject(subject: string): Promise<string | null>;

  /** Identifiant Google associé au compte ; `null` sinon. */
  abstract findSubject(accountId: string): Promise<string | null>;

  /**
   * Compte, premier profil (PRO-01) et identité, ensemble, adresse vérifiée.
   * `email_taken` / `subject_taken` : contrainte d'unicité, y compris en concurrence.
   */
  abstract createAccount(
    account: NewGoogleAccount,
  ): Promise<'created' | 'email_taken' | 'subject_taken'>;

  /**
   * Association. `subject_taken` : identifiant associé à un autre compte (ou au même) ;
   * `already_linked` : le compte a déjà une identité Google. Compte vérifié et actif exigé
   * (`not_eligible` sinon).
   */
  abstract link(input: {
    readonly id: string;
    readonly accountId: string;
    readonly subject: string;
    readonly now: Date;
  }): Promise<'linked' | 'subject_taken' | 'already_linked' | 'not_eligible'>;

  /**
   * Dissociation et époque (ADR 0014) dans une transaction, seulement si le compte a un mot de
   * passe. `not_linked` / `no_password` : rien n'est écrit, sauf l'époque (déjà portée dans Redis).
   */
  abstract unlink(
    accountId: string,
    authEpoch: number,
  ): Promise<'unlinked' | 'not_linked' | 'no_password'>;
}
