import {
  allConsentsGiven,
  consentRefusal,
  defaultPinChoice,
  departureRefusal,
  executionTime,
  isPinChoiceValid,
  isTransferExpired,
  profileConsentRequired,
  type TransferConsents,
} from './transfer';

// PRO-12 à PRO-14 : règles pures d'un changement de compte.

const now = new Date('2026-11-20T12:00:00Z');
const daysAgo = (days: number): Date => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const hoursAfter = (date: Date, hours: number): Date =>
  new Date(date.getTime() + hours * 60 * 60 * 1000);

describe('profileConsentRequired (PRO-12, B3)', () => {
  it('requis pour un profil non enfant', () => {
    expect(profileConsentRequired({ isChild: false, childChangedAt: null }, now)).toBe(true);
  });

  it('pas requis pour un enfant de toujours', () => {
    expect(profileConsentRequired({ isChild: true, childChangedAt: null }, now)).toBe(false);
  });

  it('requis pour un profil marqué enfant depuis moins de 30 jours', () => {
    expect(profileConsentRequired({ isChild: true, childChangedAt: daysAgo(29) }, now)).toBe(true);
    expect(profileConsentRequired({ isChild: true, childChangedAt: daysAgo(31) }, now)).toBe(false);
  });
});

describe('consentRefusal (PRO-12, B4 et B4 bis)', () => {
  const safe = { pinResetAt: null, emailVerifiedAt: daysAgo(30) };

  it('accord possible depuis le profil ou par une adresse ancienne', () => {
    expect(consentRefusal(safe, 'PROFILE', now)).toBeNull();
    expect(consentRefusal(safe, 'EMAIL', now)).toBeNull();
  });

  it('refusé pendant 7 jours après une réinitialisation du PIN, même par le profil', () => {
    const reset = { ...safe, pinResetAt: daysAgo(6) };
    expect(consentRefusal(reset, 'PROFILE', now)).toBe('PIN_RECENTLY_RESET');
    expect(consentRefusal(reset, 'EMAIL', now)).toBe('PIN_RECENTLY_RESET');
    expect(consentRefusal({ ...safe, pinResetAt: daysAgo(8) }, 'PROFILE', now)).toBeNull();
  });

  it('refusé par une adresse vérifiée depuis moins de 7 jours, ou non vérifiée', () => {
    expect(consentRefusal({ ...safe, emailVerifiedAt: daysAgo(3) }, 'EMAIL', now)).toBe(
      'EMAIL_TOO_RECENT',
    );
    expect(consentRefusal({ ...safe, emailVerifiedAt: null }, 'EMAIL', now)).toBe(
      'EMAIL_TOO_RECENT',
    );
    // Depuis le profil, l'âge de l'adresse ne compte pas.
    expect(consentRefusal({ ...safe, emailVerifiedAt: daysAgo(3) }, 'PROFILE', now)).toBeNull();
  });
});

describe('choix du PIN (PRO-12, B1)', () => {
  it('par défaut : garder son PIN, ou en fixer un ; jamais « aucun »', () => {
    expect(defaultPinChoice(true)).toBe('KEEP');
    expect(defaultPinChoice(false)).toBe('NEW');
  });

  it('« garder » suppose un PIN, « nouveau » un PIN fourni, « aucun » rien', () => {
    expect(isPinChoiceValid('KEEP', true, false)).toBe(true);
    expect(isPinChoiceValid('KEEP', false, false)).toBe(false);
    expect(isPinChoiceValid('NEW', false, true)).toBe(true);
    expect(isPinChoiceValid('NEW', true, false)).toBe(false);
    expect(isPinChoiceValid('NONE', true, false)).toBe(true);
    expect(isPinChoiceValid('NONE', false, true)).toBe(false);
  });
});

describe('exécution différée (PRO-12, I3 du cycle 2)', () => {
  const base: TransferConsents = {
    profileConsentRequired: true,
    fromAcceptedAt: daysAgo(5),
    toAcceptedAt: daysAgo(3),
    profileAcceptedAt: daysAgo(1),
  };

  it('48 heures après le dernier accord', () => {
    expect(executionTime(base)).toEqual(hoursAfter(daysAgo(1), 48));
  });

  it('rien tant qu’un accord manque', () => {
    expect(allConsentsGiven({ ...base, toAcceptedAt: null })).toBe(false);
    expect(executionTime({ ...base, profileAcceptedAt: null })).toBeNull();
  });

  it('l’accord du profil n’est pas attendu quand il n’est pas requis', () => {
    const child = { ...base, profileConsentRequired: false, profileAcceptedAt: null };
    expect(executionTime(child)).toEqual(hoursAfter(daysAgo(3), 48));
  });

  it('tous les accords donnés, l’expiration ne joue plus', () => {
    expect(isTransferExpired({ executesAt: null, expiresAt: daysAgo(1) }, now)).toBe(true);
    expect(isTransferExpired({ executesAt: now, expiresAt: daysAgo(1) }, now)).toBe(false);
  });
});

describe('departureRefusal (PRO-12, PRO-13, I1 du cycle 1)', () => {
  const adult = { isChild: false };
  const child = { isChild: true };

  it('un départ qui laisse un adulte passe', () => {
    expect(
      departureRefusal('MOVE', { isWard: false, remaining: [adult, child] }, false),
    ).toBeNull();
  });

  it('un compte hors tutelle ne garde pas des enfants seuls', () => {
    expect(departureRefusal('DETACH', { isWard: false, remaining: [child] }, false)).toBe(
      'GUARDIAN_REQUIRED',
    );
  });

  it('un compte sous tutelle n’a que des enfants : ce n’est pas un refus', () => {
    expect(departureRefusal('MOVE', { isWard: true, remaining: [child] }, false)).toBeNull();
  });

  it('le dernier profil : regroupement déclaré seulement, et par un passage', () => {
    expect(departureRefusal('MOVE', { isWard: false, remaining: [] }, true)).toBeNull();
    expect(departureRefusal('MOVE', { isWard: false, remaining: [] }, false)).toBe(
      'UNDECLARED_REGROUP',
    );
    expect(departureRefusal('DETACH', { isWard: false, remaining: [] }, true)).toBe('LAST_PROFILE');
  });
});
