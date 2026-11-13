import type { AppConfig } from '../../../platform/config/env';
import { AesGcmSecretCipher } from './aes-secret-cipher';
import { OtplibTotpEngine } from './otplib-totp-engine';

const key = (fill: number): Buffer => Buffer.alloc(32, fill);
const config = (keys: { id: number; key: Buffer }[]): AppConfig =>
  ({ env: { SECRET_ENCRYPTION_KEYS: keys } }) as unknown as AppConfig;

describe('AesGcmSecretCipher (SEC-22, AUTH-11)', () => {
  const cipher = new AesGcmSecretCipher(config([{ id: 1, key: key(1) }]));

  it('chiffre et déchiffre ; le clair n’apparaît pas ; IV aléatoire', () => {
    const a = cipher.encrypt('JBSWY3DPEHPK3PXP', 'totp:compte-a');
    const b = cipher.encrypt('JBSWY3DPEHPK3PXP', 'totp:compte-a');
    expect(Buffer.from(a).toString('latin1')).not.toContain('JBSWY3DPEHPK3PXP');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(cipher.decrypt(a, 'totp:compte-a')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('refuse un chiffré recopié sur un autre compte (contexte authentifié)', () => {
    const sealed = cipher.encrypt('secret', 'totp:compte-a');
    expect(() => cipher.decrypt(sealed, 'totp:compte-b')).toThrow();
  });

  it('refuse un chiffré altéré, en-tête compris', () => {
    const sealed = Buffer.from(cipher.encrypt('secret', 'totp:compte-a'));
    const body = Buffer.from(sealed);
    body[body.length - 1] = (body[body.length - 1] ?? 0) ^ 1;
    expect(() => cipher.decrypt(body, 'totp:compte-a')).toThrow();
    const header = Buffer.from(sealed);
    header[0] = 2;
    expect(() => cipher.decrypt(header, 'totp:compte-a')).toThrow();
  });

  it('rotation : la nouvelle clé chiffre, l’ancienne déchiffre encore ; clé inconnue refusée', () => {
    const before = cipher.encrypt('secret', 'totp:compte-a');
    const rotated = new AesGcmSecretCipher(
      config([
        { id: 2, key: key(2) },
        { id: 1, key: key(1) },
      ]),
    );
    expect(rotated.decrypt(before, 'totp:compte-a')).toBe('secret');
    const after = rotated.encrypt('secret', 'totp:compte-a');
    expect(after[1]).toBe(2);
    expect(() => cipher.decrypt(after, 'totp:compte-a')).toThrow();
  });
});

describe('OtplibTotpEngine (AUTH-10, AUTH-11)', () => {
  const engine = new OtplibTotpEngine();
  // RFC 6238, annexe B : secret ASCII « 12345678901234567890 », SHA-1, T = 59 s → 94287082.
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const at59 = new Date(59_000);

  it('vecteur de la RFC 6238 (6 chiffres) : pas de temps 1', async () => {
    await expect(
      engine.verify({ secret: RFC_SECRET, code: '287082', now: at59, afterStep: null }),
    ).resolves.toBe(1);
  });

  it('un pas d’écart toléré, pas deux', async () => {
    await expect(
      engine.verify({ secret: RFC_SECRET, code: '287082', now: new Date(89_000), afterStep: null }),
    ).resolves.toBe(1);
    await expect(
      engine.verify({
        secret: RFC_SECRET,
        code: '287082',
        now: new Date(120_000),
        afterStep: null,
      }),
    ).resolves.toBeNull();
  });

  it('AUTH-11 : un pas égal ou antérieur au dernier accepté est refusé', async () => {
    await expect(
      engine.verify({ secret: RFC_SECRET, code: '287082', now: at59, afterStep: 1 }),
    ).resolves.toBeNull();
    await expect(
      engine.verify({ secret: RFC_SECRET, code: '287082', now: at59, afterStep: 0 }),
    ).resolves.toBe(1);
  });

  it('code faux ou mal formé : refus, sans exception', async () => {
    await expect(
      engine.verify({ secret: RFC_SECRET, code: '000000', now: at59, afterStep: null }),
    ).resolves.toBeNull();
    await expect(
      engine.verify({ secret: RFC_SECRET, code: 'abc', now: at59, afterStep: null }),
    ).resolves.toBeNull();
  });

  it('secret de 160 bits en base32 ; URI otpauth avec émetteur, réglages par défaut', () => {
    const secret = engine.generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const uri = engine.uri({ label: 'camille@lahotte.test', secret });
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain('issuer=La%20Hotte');
    // SHA-1, 6 chiffres, 30 s : valeurs par défaut du format, omises (lues par toutes les applications).
    expect(uri).not.toMatch(/algorithm=|digits=|period=/);
  });
});
