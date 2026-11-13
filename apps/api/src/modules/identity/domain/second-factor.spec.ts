import {
  encodeRecoveryCode,
  formatRecoveryCode,
  normalizeRecoveryCode,
  normalizeTotpCode,
  parseSecondFactorCode,
  requiresSecondFactor,
} from './second-factor';

describe('Second facteur, règles pures', () => {
  it('AUTH-10 : un code TOTP a 6 chiffres, espaces tolérés', () => {
    expect(normalizeTotpCode('123 456')).toBe('123456');
    expect(normalizeTotpCode('12345')).toBeNull();
    expect(normalizeTotpCode('1234567')).toBeNull();
    expect(normalizeTotpCode('12a456')).toBeNull();
  });

  it('AUTH-10 : code de secours de 80 bits, 16 caractères de Crockford, groupés par quatre', () => {
    const code = encodeRecoveryCode(new Uint8Array(10).fill(0xff));
    expect(code).toBe('ZZZZZZZZZZZZZZZZ');
    expect(encodeRecoveryCode(new Uint8Array(10))).toBe('0000000000000000');
    expect(formatRecoveryCode(code)).toBe('ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    expect(() => encodeRecoveryCode(new Uint8Array(9))).toThrow();
  });

  it('AUTH-10 : saisie d’un code de secours tolérante (tirets, espaces, casse, O/I/L)', () => {
    expect(normalizeRecoveryCode('7k2m-9qxa 4tOp-zr8h')).toBe('7K2M9QXA4T0PZR8H');
    expect(normalizeRecoveryCode('ilIL-0000-0000-0000')).toBe('1111000000000000');
    expect(normalizeRecoveryCode('7K2M-9QXA-4T0P')).toBeNull();
    // U ne fait pas partie de l'alphabet de Crockford.
    expect(normalizeRecoveryCode('UUUU-UUUU-UUUU-UUUU')).toBeNull();
  });

  it('distingue un code TOTP d’un code de secours, refuse le reste', () => {
    expect(parseSecondFactorCode('123456')).toEqual({ kind: 'totp', code: '123456' });
    expect(parseSecondFactorCode('7K2M-9QXA-4T0P-ZR8H')).toEqual({
      kind: 'recovery',
      code: '7K2M9QXA4T0PZR8H',
    });
    expect(parseSecondFactorCode('abc')).toBeNull();
  });

  it('AUTH-13 : TOTP obligatoire pour ADMIN et MODERATOR seulement', () => {
    expect(requiresSecondFactor('ADMIN')).toBe(true);
    expect(requiresSecondFactor('MODERATOR')).toBe(true);
    expect(requiresSecondFactor('USER')).toBe(false);
  });
});
