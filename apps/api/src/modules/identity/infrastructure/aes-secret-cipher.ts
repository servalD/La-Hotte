import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../../platform/config/env';
import { AesGcmKeyring } from '../../../platform/crypto/aes-gcm';
import { SecretCipher } from '../domain/second-factor.ports';

/**
 * SEC-22, AUTH-11 : secrets TOTP en AES-256-GCM (`platform/crypto/aes-gcm`), le compte en
 * contexte authentifié : un chiffré recopié sur un autre compte ne se déchiffre pas.
 */
@Injectable()
export class AesGcmSecretCipher extends SecretCipher {
  private readonly keyring: AesGcmKeyring;

  constructor(config: AppConfig) {
    super();
    this.keyring = new AesGcmKeyring(config.env.SECRET_ENCRYPTION_KEYS);
  }

  encrypt(plaintext: string, context: string): Uint8Array {
    return this.keyring.encrypt(plaintext, context);
  }

  decrypt(ciphertext: Uint8Array, context: string): string {
    return this.keyring.decrypt(ciphertext, context);
  }
}
