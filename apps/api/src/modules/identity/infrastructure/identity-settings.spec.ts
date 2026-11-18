import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../platform/config/env';
import { InMemoryPlatformSettings } from '../../../platform/settings/in-memory-platform-settings';
import { EnvIdentitySettings } from './in-process-background-tasks';

// AUTH-09, ADM-09 : la valeur réglée par un administrateur prime sur l'environnement.
describe('Mode d’inscription', () => {
  const config = {
    env: { REGISTRATION_MODE: 'OPEN', WEB_ORIGIN: 'https://lahotte.example/' },
  } as unknown as AppConfig;

  it('valeur de l’environnement tant qu’aucun réglage n’est posé, puis le réglage', () => {
    const platform = new InMemoryPlatformSettings();
    const settings = new EnvIdentitySettings(config, platform);
    expect(settings.registrationMode).toBe('OPEN');
    platform.values = { ...platform.values, registration_mode: 'INVITE_ONLY' };
    expect(settings.registrationMode).toBe('INVITE_ONLY');
    platform.values = { ...platform.values, registration_mode: null };
    expect(settings.registrationMode).toBe('OPEN');
    expect(settings.webOrigin).toBe('https://lahotte.example');
  });
});
