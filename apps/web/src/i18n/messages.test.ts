import en from '../../messages/en.json';
import fr from '../../messages/fr.json';

// I18N-01 : l'anglais est prêt — mêmes clés que le français, aucune valeur vide.
function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? keys(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

function values(obj: Record<string, unknown>): unknown[] {
  return Object.values(obj).flatMap((v) =>
    typeof v === 'object' && v !== null ? values(v as Record<string, unknown>) : [v],
  );
}

describe('messages (I18N-01, UX-08)', () => {
  it('fr et en ont exactement les mêmes clés', () => {
    expect(keys(en).sort()).toEqual(keys(fr).sort());
  });

  it('aucune traduction vide', () => {
    for (const v of [...values(fr), ...values(en)]) expect(String(v).trim()).not.toBe('');
  });

  it('UX-08 : aucun terme banni', () => {
    const banned = /whitelist|blacklist|synchronisation|RBAC/i;
    for (const v of [...values(fr), ...values(en)]) expect(String(v)).not.toMatch(banned);
  });
});
