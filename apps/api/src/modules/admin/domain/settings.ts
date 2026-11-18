import {
  DomainError,
  normalizeTerm,
  type PlatformSettingKey,
  type PlatformSettingValues,
} from '../../../shared/domain';

/** ADM-09 : valeur refusée pour ce réglage. */
export class SettingInvalidError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'SETTING_INVALID';

  constructor() {
    super('Valeur refusée pour ce réglage.');
  }
}

export const SETTING_LIST_MAX = 500;
const TERM_MAX = 100;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const EXTRACTION_DAILY_LIMIT_MAX = 1000;

function list(raw: unknown, clean: (item: string) => string | null): string[] {
  if (!Array.isArray(raw) || raw.length > SETTING_LIST_MAX) throw new SettingInvalidError();
  const out = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') throw new SettingInvalidError();
    const value = clean(item);
    if (value === null) throw new SettingInvalidError();
    out.add(value);
  }
  return [...out].sort();
}

/**
 * ADM-09 : valide et normalise une valeur. `null` rend la valeur par défaut aux réglages qui en
 * ont une. Une liste est dédoublonnée et triée, pour que l'audit compare des valeurs stables.
 */
export function validateSetting<K extends PlatformSettingKey>(
  key: K,
  raw: unknown,
): PlatformSettingValues[K] {
  const value = ((): PlatformSettingValues[PlatformSettingKey] => {
    switch (key) {
      case 'registration_mode':
        if (raw === null || raw === 'OPEN' || raw === 'INVITE_ONLY') return raw;
        throw new SettingInvalidError();
      case 'extraction_daily_limit':
        if (raw === null) return null;
        if (
          typeof raw === 'number' &&
          Number.isInteger(raw) &&
          raw >= 0 &&
          raw <= EXTRACTION_DAILY_LIMIT_MAX
        ) {
          return raw;
        }
        throw new SettingInvalidError();
      case 'forbidden_terms':
        return list(raw, (item) => {
          const term = normalizeTerm(item);
          return term.length > 0 && term.length <= TERM_MAX ? term : null;
        });
      case 'blocked_domains':
        return list(raw, (item) => {
          const domain = item.trim().toLowerCase().replace(/\.$/, '');
          return DOMAIN_PATTERN.test(domain) ? domain : null;
        });
      default:
        throw new SettingInvalidError();
    }
  })();
  return value as PlatformSettingValues[K];
}

export { normalizeTerm };
