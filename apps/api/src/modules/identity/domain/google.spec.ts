import { decideNewGoogleAccount, isFreshFor, isPlausibleEmail, isValidSubject } from './google';

// AUTH-03, AUTH-15, AUTH-16 : connexion Google sans identité connue.

const claims = (emailVerified: boolean, email: string | null = 'a@gmail.test') => ({
  subject: '123',
  email,
  emailVerified,
  authTime: null,
});

describe('decideNewGoogleAccount', () => {
  it('AUTH-03 : adresse non vérifiée par Google, ou absente : rien', () => {
    expect(decideNewGoogleAccount({ claims: claims(false), existing: null, reserved: false })).toBe(
      'unverified_email',
    );
    expect(
      decideNewGoogleAccount({ claims: claims(true, null), existing: null, reserved: false }),
    ).toBe('unverified_email');
    // Même face à un compte non vérifié : pas de remplacement sans garantie de Google.
    expect(
      decideNewGoogleAccount({
        claims: claims(false),
        existing: { emailVerified: false },
        reserved: false,
      }),
    ).toBe('unverified_email');
  });

  it('AUTH-03 : compte vérifié de même adresse, jamais de fusion', () => {
    expect(
      decideNewGoogleAccount({
        claims: claims(true),
        existing: { emailVerified: true },
        reserved: false,
      }),
    ).toBe('link_required');
  });

  it('AUTH-15 : compte non vérifié de même adresse, remplacé', () => {
    expect(
      decideNewGoogleAccount({
        claims: claims(true),
        existing: { emailVerified: false },
        reserved: false,
      }),
    ).toBe('replace');
  });

  it('AUTH-16 : adresse réservée par un lien d’annulation', () => {
    expect(decideNewGoogleAccount({ claims: claims(true), existing: null, reserved: true })).toBe(
      'unavailable',
    );
  });

  it('adresse libre : création', () => {
    expect(decideNewGoogleAccount({ claims: claims(true), existing: null, reserved: false })).toBe(
      'create',
    );
  });
});

describe('isValidSubject', () => {
  it('ASCII imprimable, 1 à 255 caractères', () => {
    expect(isValidSubject('109876543210987654321')).toBe(true);
    expect(isValidSubject('')).toBe(false);
    expect(isValidSubject('a b')).toBe(false);
    expect(isValidSubject('é')).toBe(false);
    expect(isValidSubject('x'.repeat(256))).toBe(false);
  });
});

describe('isFreshFor (AUTH-14)', () => {
  const start = new Date('2026-11-13T12:00:00Z');
  it('authentification après le départ du parcours, à 30 s près', () => {
    expect(isFreshFor(new Date('2026-11-13T12:01:00Z'), start)).toBe(true);
    expect(isFreshFor(new Date('2026-11-13T11:59:40Z'), start)).toBe(true);
  });
  it('avant le départ, ou sans auth_time : non', () => {
    expect(isFreshFor(new Date('2026-11-13T11:58:00Z'), start)).toBe(false);
    expect(isFreshFor(null, start)).toBe(false);
  });
});

describe('isPlausibleEmail', () => {
  it('une @, un domaine pointé, ni espace ni contrôle', () => {
    expect(isPlausibleEmail('camille@gmail.com')).toBe(true);
    expect(isPlausibleEmail('camille@localhost')).toBe(false);
    expect(isPlausibleEmail('a@b@c.fr')).toBe(false);
    expect(isPlausibleEmail('a b@c.fr')).toBe(false);
    expect(isPlausibleEmail('a@c.fr\r\nBcc: x@y.fr')).toBe(false);
  });
  it('adresse invalide : rien n’est créé', () => {
    expect(
      decideNewGoogleAccount({
        claims: claims(true, 'pas-une-adresse'),
        existing: null,
        reserved: false,
      }),
    ).toBe('unavailable');
  });
});
