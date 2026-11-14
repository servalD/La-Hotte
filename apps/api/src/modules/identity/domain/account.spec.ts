import {
  ACCENT_COLORS,
  ACCOUNT_TOKEN_LIFETIME_MS,
  accentColorFor,
  isPasswordLengthValid,
  normalizeEmail,
  passwordLength,
  tokenExpiry,
} from './account';

describe('Compte (domaine)', () => {
  it('normalise l’e-mail : espaces, casse, forme Unicode (clé d’unicité et de limitation)', () => {
    expect(normalizeEmail('  Camille.Dupont@Exemple.FR ')).toBe('camille.dupont@exemple.fr');
    expect(normalizeEmail('é@x.fr')).toBe(normalizeEmail('é@x.fr'));
  });

  it('AUTH-02 : longueur comptée en caractères, 12 à 256', () => {
    expect(isPasswordLengthValid('a'.repeat(11))).toBe(false);
    expect(isPasswordLengthValid('a'.repeat(12))).toBe(true);
    expect(isPasswordLengthValid('a'.repeat(256))).toBe(true);
    expect(isPasswordLengthValid('a'.repeat(257))).toBe(false);
    // 12 émojis = 24 unités UTF-16, mais 12 caractères.
    expect(passwordLength('😀'.repeat(12))).toBe(12);
    // 6 émojis = 12 unités UTF-16 : trop court.
    expect(isPasswordLengthValid('😀'.repeat(6))).toBe(false);
  });

  it('durées des jetons (`01`, « Valeurs par défaut »)', () => {
    const now = new Date('2026-11-13T10:00:00Z');
    expect(tokenExpiry('PASSWORD_RESET', now).toISOString()).toBe('2026-11-13T10:30:00.000Z');
    expect(ACCOUNT_TOKEN_LIFETIME_MS.EMAIL_CHANGE).toBe(24 * 3_600_000);
    expect(ACCOUNT_TOKEN_LIFETIME_MS.EMAIL_VERIFY).toBe(7 * 24 * 3_600_000);
    expect(ACCOUNT_TOKEN_LIFETIME_MS.EMAIL_CHANGE_CANCEL).toBe(7 * 24 * 3_600_000);
  });

  it('PRO-02 : couleur d’accent stable, tirée de la palette', () => {
    const id = '0190f3c2-0000-7000-8000-0000000000ab';
    expect(accentColorFor(id)).toBe(accentColorFor(id));
    expect(ACCENT_COLORS).toContain(accentColorFor(id));
    expect(accentColorFor('')).toBe(ACCENT_COLORS[0]);
  });
});
