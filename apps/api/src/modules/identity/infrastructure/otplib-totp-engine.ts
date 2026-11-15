import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verify } from 'otplib';
import {
  TOTP_DIGITS,
  TOTP_ISSUER,
  TOTP_PERIOD_SECONDS,
  TOTP_TOLERANCE_STEPS,
} from '../domain/second-factor';
import { TotpEngine } from '../domain/second-factor.ports';

/**
 * AUTH-10, AUTH-11 (ADR 0003 : `otplib`). SHA-1, 6 chiffres, 30 secondes : les réglages que toutes
 * les applications d'authentification lisent. Un pas d'écart toléré de part et d'autre ; un pas
 * égal ou antérieur au dernier accepté est refusé (`afterTimeStep`), et le dépôt le revérifie
 * atomiquement.
 */
@Injectable()
export class OtplibTotpEngine extends TotpEngine {
  generateSecret(): string {
    // 20 octets : 160 bits (RFC 4226, longueur recommandée).
    return generateSecret({ length: 20 });
  }

  uri(input: { label: string; secret: string }): string {
    return generateURI({
      issuer: TOTP_ISSUER,
      label: input.label,
      secret: input.secret,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD_SECONDS,
    });
  }

  async verify(input: {
    secret: string;
    code: string;
    now: Date;
    afterStep: number | null;
  }): Promise<number | null> {
    try {
      const result = await verify({
        strategy: 'totp',
        secret: input.secret,
        token: input.code,
        digits: TOTP_DIGITS,
        period: TOTP_PERIOD_SECONDS,
        epoch: Math.floor(input.now.getTime() / 1000),
        epochTolerance: TOTP_TOLERANCE_STEPS * TOTP_PERIOD_SECONDS,
        ...(input.afterStep !== null ? { afterTimeStep: input.afterStep } : {}),
      });
      // Le type commun à HOTP et TOTP ne porte `timeStep` que pour TOTP.
      return result.valid && 'timeStep' in result ? result.timeStep : null;
    } catch {
      // Code de forme inattendue : refus, sans reprendre le message (il peut citer le code).
      return null;
    }
  }
}
