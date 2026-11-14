import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../../platform/config/env';
import { CsrfTokens, SecretTokens } from '../domain/ports';
import { encodeRecoveryCode } from '../domain/second-factor';

/** 32 octets en base64url, sans remplissage : 43 caractères. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** ADR 0013, « Jeton et cookies » : 256 bits tirés par `node:crypto`, stockés en SHA-256. */
@Injectable()
export class CryptoSecretTokens extends SecretTokens {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  isWellFormed(token: string): boolean {
    return TOKEN_PATTERN.test(token);
  }

  generateInvitation(): string {
    return randomBytes(16).toString('base64url');
  }

  generateRecoveryCode(): string {
    return encodeRecoveryCode(randomBytes(10));
  }
}

/**
 * ADR 0013, « CSRF » : HMAC-SHA256(CSRF_SECRET, préfixe ‖ valeur). Les préfixes `session:` et
 * `presession:` séparent les deux usages du secret.
 */
@Injectable()
export class HmacCsrfTokens extends CsrfTokens {
  private readonly secret: string;

  constructor(config: AppConfig) {
    super();
    this.secret = config.env.CSRF_SECRET;
  }

  forSession(tokenHash: string): string {
    return this.sign(`session:${tokenHash}`);
  }

  forPresession(presessionId: string): string {
    return this.sign(`presession:${presessionId}`);
  }

  matches(expected: string, received: string): boolean {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(received, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private sign(value: string): string {
    return createHmac('sha256', this.secret).update(value, 'utf8').digest('base64url');
  }
}
