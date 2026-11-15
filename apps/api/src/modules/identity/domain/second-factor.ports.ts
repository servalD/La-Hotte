import type {
  NewTrustedDevice,
  PendingSecondFactor,
  TotpState,
  TrustedDeviceSummary,
} from './second-factor';

/**
 * Chiffrement applicatif (SEC-22, AUTH-11) : AES-256-GCM, clé hors base. `context` est lié au
 * chiffré (données authentifiées) : un secret recopié sur un autre compte ne se déchiffre pas.
 */
export abstract class SecretCipher {
  abstract encrypt(plaintext: string, context: string): Uint8Array;
  /** Lève si le chiffré a été altéré, vient d'un autre contexte ou d'une clé inconnue. */
  abstract decrypt(ciphertext: Uint8Array, context: string): string;
}

/** TOTP (AUTH-10, RFC 6238). */
export abstract class TotpEngine {
  /** Secret base32 de 160 bits. */
  abstract generateSecret(): string;
  /** URI `otpauth://` pour le QR code. */
  abstract uri(input: { readonly label: string; readonly secret: string }): string;
  /**
   * Pas de temps du code s'il est valable à `now` (± un pas) **et** postérieur à `afterStep`
   * (AUTH-11) ; `null` sinon.
   */
  abstract verify(input: {
    readonly secret: string;
    readonly code: string;
    readonly now: Date;
    readonly afterStep: number | null;
  }): Promise<number | null>;
}

/**
 * TOTP et codes de secours en base. Chaque méthode qui écrit est atomique ; les conditions sont
 * dans la requête, pas lues avant (deux requêtes concurrentes ne réussissent jamais toutes deux).
 */
export abstract class SecondFactorRepository {
  abstract findTotp(accountId: string): Promise<TotpState | null>;

  /** Nouveau secret en attente, seulement si le TOTP n'est pas actif. Faux sinon. */
  abstract startEnrollment(accountId: string, secretEnc: Uint8Array, now: Date): Promise<boolean>;

  /**
   * Activation (AUTH-10) : seulement si le secret en attente est toujours `secretEnc` (une
   * inscription concurrente l'aurait remplacé) ; pas accepté noté (AUTH-11) ; codes de secours
   * remplacés. Faux sinon, rien n'est écrit.
   */
  abstract activate(input: {
    readonly accountId: string;
    readonly secretEnc: Uint8Array;
    readonly step: number;
    readonly recoveryCodeHashes: readonly string[];
    /** Époque écrite dans la même transaction (AUTH-05, ADR 0014). */
    readonly authEpoch: number;
    readonly now: Date;
  }): Promise<boolean>;

  /** AUTH-11 : pas noté s'il est postérieur au dernier accepté et le TOTP actif. Faux sinon. */
  abstract consumeStep(accountId: string, step: number): Promise<boolean>;

  /** Code de secours marqué utilisé s'il ne l'était pas, TOTP actif. Faux sinon. */
  abstract consumeRecoveryCode(accountId: string, codeHash: string, now: Date): Promise<boolean>;

  /** Codes de secours remplacés, TOTP actif. Faux sinon. */
  abstract replaceRecoveryCodes(
    accountId: string,
    codeHashes: readonly string[],
    now: Date,
  ): Promise<boolean>;

  abstract countUnusedRecoveryCodes(accountId: string): Promise<number>;

  /**
   * Désactivation (AUTH-05) dans une transaction : époque écrite (ADR 0014), secret et pas
   * effacés, codes de secours supprimés, appareils de confiance révoqués.
   */
  abstract disable(accountId: string, authEpoch: number, now: Date): Promise<void>;
}

/** Appareils de confiance (AUTH-12, ADR 0013), révocables depuis l'espace Compte. */
export abstract class TrustedDeviceRepository {
  abstract create(device: NewTrustedDevice): Promise<void>;
  /** Appareil non révoqué et non expiré portant ce hash ; `null` sinon. */
  abstract findActive(
    tokenHash: string,
    now: Date,
  ): Promise<{ readonly id: string; readonly accountId: string } | null>;
  abstract listActive(accountId: string, now: Date): Promise<TrustedDeviceSummary[]>;
  /** Révocation d'un appareil **du compte** ; faux s'il n'existe pas ou est d'un autre compte. */
  abstract revoke(accountId: string, deviceId: string, now: Date): Promise<boolean>;
}

/** Pré-authentifications (ADR 0013) : Redis seul, 5 minutes. Panne : `IdentityUnavailableError`. */
export abstract class PendingSecondFactors {
  abstract create(tokenHash: string, pending: PendingSecondFactor, ttlMs: number): Promise<void>;
  abstract find(tokenHash: string): Promise<PendingSecondFactor | null>;
  /** Lecture et suppression atomiques : une seule requête l'obtient. */
  abstract consume(tokenHash: string): Promise<PendingSecondFactor | null>;
}
