import type { SessionStatusView } from '@wishlist/api-client';
import { describe, expect, it } from 'vitest';
import { nextRoute } from './next-route';

const session = {
  id: '00000000-0000-4000-8000-000000000001',
  activeProfileId: '00000000-0000-4000-8000-000000000002',
  profileUnlocked: true,
  expiresAt: '2030-01-01T00:00:00Z',
  sharedDevice: false,
  accountTag: '0'.repeat(32),
};

const base: SessionStatusView = {
  authenticated: true,
  csrfToken: 'x',
  secondFactorPending: false,
  session,
};

describe('nextRoute (PIN-02, AUTH-12)', () => {
  it('renvoie vers la connexion sans session', () => {
    expect(nextRoute({ ...base, authenticated: false, session: null }, 'session')).toBe(
      '/auth/login',
    );
  });
  it('renvoie vers le second facteur quand il est attendu', () => {
    expect(
      nextRoute(
        { ...base, authenticated: false, session: null, secondFactorPending: true },
        'profile',
      ),
    ).toBe('/auth/second-factor');
  });
  it("laisse entrer dans l'espace Compte sans profil actif", () => {
    const status = { ...base, session: { ...session, activeProfileId: null } };
    expect(nextRoute(status, 'session')).toBeNull();
    expect(nextRoute(status, 'profile')).toBe('/profiles');
  });
  it('demande le PIN tant que le profil est verrouillé', () => {
    const status = { ...base, session: { ...session, profileUnlocked: false } };
    expect(nextRoute(status, 'profile')).toBe('/profiles/unlock');
    expect(nextRoute(status, 'session')).toBeNull();
  });
  it('laisse passer un profil déverrouillé', () => {
    expect(nextRoute(base, 'profile')).toBeNull();
  });
});
