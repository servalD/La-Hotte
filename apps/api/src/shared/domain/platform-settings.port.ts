import type { AuditWrite } from './audit';

/**
 * Réglages de plateforme (ADM-09), liste fermée. `null` : la valeur par défaut s'applique
 * (`REGISTRATION_MODE` de l'environnement, 200 extractions par compte et par jour, EXT-34).
 */
export interface PlatformSettingValues {
  readonly registration_mode: 'OPEN' | 'INVITE_ONLY' | null;
  readonly forbidden_terms: readonly string[];
  readonly blocked_domains: readonly string[];
  readonly extraction_daily_limit: number | null;
}

export type PlatformSettingKey = keyof PlatformSettingValues;

export const PLATFORM_SETTING_KEYS = [
  'registration_mode',
  'forbidden_terms',
  'blocked_domains',
  'extraction_daily_limit',
] as const satisfies readonly PlatformSettingKey[];

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettingValues = {
  registration_mode: null,
  forbidden_terms: [],
  blocked_domains: [],
  extraction_daily_limit: null,
};

export interface SettingWrite<K extends PlatformSettingKey> {
  readonly key: K;
  readonly value: PlatformSettingValues[K];
  readonly updatedBy: string;
  readonly audit: (before: PlatformSettingValues[K]) => AuditWrite;
}

export abstract class PlatformSettings {
  /** Valeurs en mémoire, relues en base au plus toutes les 30 secondes. Jamais d'attente. */
  abstract current(): PlatformSettingValues;

  /**
   * ADM-09, AUD-05 : écrit la valeur et son entrée d'audit dans une transaction, puis met la
   * mémoire à jour. Rend la valeur précédente.
   */
  abstract write<K extends PlatformSettingKey>(
    input: SettingWrite<K>,
  ): Promise<PlatformSettingValues[K]>;
}
