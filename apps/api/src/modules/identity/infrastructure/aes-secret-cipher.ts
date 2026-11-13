import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfig, type EncryptionKey } from '../../../platform/config/env';
import { SecretCipher } from '../domain/second-factor.ports';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 2;

/**
 * SEC-22, AUTH-11 : AES-256-GCM, clé hors base (`SECRET_ENCRYPTION_KEYS`). Forme :
 * `version (1) ‖ identifiant de clé (1) ‖ IV (12) ‖ étiquette (16) ‖ chiffré`. L'en-tête et le
 * contexte (identifiant du compte) sont des données authentifiées : changer la clé désignée ou
 * recopier le chiffré sur un autre compte fait échouer le déchiffrement. Rotation : la première
 * clé du trousseau chiffre, toutes déchiffrent.
 */
@Injectable()
export class AesGcmSecretCipher extends SecretCipher {
  private readonly keys: readonly EncryptionKey[];

  constructor(config: AppConfig) {
    super();
    this.keys = config.env.SECRET_ENCRYPTION_KEYS;
    if (this.keys.length === 0) throw new Error('Trousseau de chiffrement vide');
  }

  encrypt(plaintext: string, context: string): Uint8Array {
    const current = this.keys[0];
    if (!current) throw new Error('Trousseau de chiffrement vide');
    const header = Buffer.from([VERSION, current.id]);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', current.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.concat([header, Buffer.from(context, 'utf8')]));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([header, iv, cipher.getAuthTag(), body]);
  }

  decrypt(ciphertext: Uint8Array, context: string): string {
    const data = Buffer.from(ciphertext);
    if (data.length <= HEADER_BYTES + IV_BYTES + TAG_BYTES || data[0] !== VERSION) {
      throw new Error('Chiffré illisible');
    }
    const key = this.keys.find((k) => k.id === data[1]);
    if (!key) throw new Error('Clé de chiffrement inconnue');
    const header = data.subarray(0, HEADER_BYTES);
    const iv = data.subarray(HEADER_BYTES, HEADER_BYTES + IV_BYTES);
    const tag = data.subarray(HEADER_BYTES + IV_BYTES, HEADER_BYTES + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key.key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.concat([header, Buffer.from(context, 'utf8')]));
    decipher.setAuthTag(tag);
    try {
      const body = data.subarray(HEADER_BYTES + IV_BYTES + TAG_BYTES);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      // Le message d'origine n'est pas repris.
      throw new Error('Chiffré altéré ou d’un autre contexte');
    }
  }
}
