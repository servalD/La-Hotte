import { describe, expect, it } from 'vitest';
import { normalizeTerm, SettingInvalidError, validateSetting } from './settings';

describe('Réglages de plateforme (ADM-09, MOD-09)', () => {
  it('mode d’inscription : liste fermée, null rend la valeur par défaut', () => {
    expect(validateSetting('registration_mode', 'INVITE_ONLY')).toBe('INVITE_ONLY');
    expect(validateSetting('registration_mode', null)).toBeNull();
    expect(() => validateSetting('registration_mode', 'CLOSED')).toThrow(SettingInvalidError);
  });

  it('plafond d’extraction : entier de 0 à 1000', () => {
    expect(validateSetting('extraction_daily_limit', 0)).toBe(0);
    expect(validateSetting('extraction_daily_limit', 1000)).toBe(1000);
    for (const bad of [-1, 1001, 2.5, '10']) {
      expect(() => validateSetting('extraction_daily_limit', bad)).toThrow(SettingInvalidError);
    }
  });

  it('termes interdits : sans accent ni casse, dédoublonnés et triés', () => {
    expect(validateSetting('forbidden_terms', ['Contrefaçon', 'contrefacon', '  Arme  '])).toEqual([
      'arme',
      'contrefacon',
    ]);
    expect(() => validateSetting('forbidden_terms', [''])).toThrow(SettingInvalidError);
    expect(() => validateSetting('forbidden_terms', ['x'.repeat(101)])).toThrow(
      SettingInvalidError,
    );
    expect(() => validateSetting('forbidden_terms', 'arme')).toThrow(SettingInvalidError);
    expect(() =>
      validateSetting(
        'forbidden_terms',
        Array.from({ length: 501 }, (_, i) => `t${i}`),
      ),
    ).toThrow(SettingInvalidError);
  });

  it('domaines bloqués : noms d’hôte seulement', () => {
    expect(validateSetting('blocked_domains', ['Exemple.FR.', 'boutique.exemple.fr'])).toEqual([
      'boutique.exemple.fr',
      'exemple.fr',
    ]);
    for (const bad of ['https://exemple.fr', 'exemple', '-x.fr', 'a b.fr']) {
      expect(() => validateSetting('blocked_domains', [bad])).toThrow(SettingInvalidError);
    }
  });

  it('normalise espaces et diacritiques', () => {
    expect(normalizeTerm('  Éléphant   ROSE ')).toBe('elephant rose');
  });
});
