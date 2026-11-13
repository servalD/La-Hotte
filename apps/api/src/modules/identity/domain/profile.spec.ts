import {
  isBirthdayValid,
  isPinWellFormed,
  isTimezoneValid,
  normalizeDisplayName,
  pinLockDelayMs,
} from './profile';

const MINUTE = 60_000;

describe('PIN-01 : forme du PIN', () => {
  it.each(['1234', '00000000', '4321567'])('accepte %s', (pin) => {
    expect(isPinWellFormed(pin)).toBe(true);
  });

  it.each(['123', '123456789', '12a4', ' 1234', '١٢٣٤', ''])('refuse %j', (pin) => {
    expect(isPinWellFormed(pin)).toBe(false);
  });
});

describe('PIN-03 : attente croissante', () => {
  it('rien avant la 5ᵉ erreur, puis 1, 5, 15 minutes, puis une heure', () => {
    expect([1, 2, 3, 4].map(pinLockDelayMs)).toEqual([0, 0, 0, 0]);
    expect(pinLockDelayMs(5)).toBe(MINUTE);
    expect(pinLockDelayMs(6)).toBe(5 * MINUTE);
    expect(pinLockDelayMs(7)).toBe(15 * MINUTE);
    expect(pinLockDelayMs(8)).toBe(60 * MINUTE);
    expect(pinLockDelayMs(500)).toBe(60 * MINUTE);
  });
});

describe('PRO-02 : anniversaire, fuseau, nom', () => {
  it('29 février sans année ou en année bissextile seulement', () => {
    expect(isBirthdayValid(29, 2, null)).toBe(true);
    expect(isBirthdayValid(29, 2, 2024)).toBe(true);
    expect(isBirthdayValid(29, 2, 2023)).toBe(false);
    expect(isBirthdayValid(31, 4, null)).toBe(false);
    expect(isBirthdayValid(0, 1, null)).toBe(false);
    expect(isBirthdayValid(1, 13, null)).toBe(false);
    expect(isBirthdayValid(1, 1, 1899)).toBe(false);
  });

  it('fuseau IANA', () => {
    expect(isTimezoneValid('Europe/Paris')).toBe(true);
    expect(isTimezoneValid('Mars/Olympus')).toBe(false);
    expect(isTimezoneValid('')).toBe(false);
  });

  it('nom affiché : espaces de bord retirés, forme NFC', () => {
    expect(normalizeDisplayName('  Léa ')).toBe('Léa');
  });
});
