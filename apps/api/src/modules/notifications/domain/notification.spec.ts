import {
  channelEnabled,
  DEFAULT_SETTINGS,
  inQuietHours,
  localMinutes,
  pushDueAt,
} from './notification';

describe('NOT-14 : heures calmes', () => {
  it('fenêtre qui passe minuit (21 h à 8 h)', () => {
    expect(inQuietHours(DEFAULT_SETTINGS, 20 * 60 + 59)).toBe(false);
    expect(inQuietHours(DEFAULT_SETTINGS, 21 * 60)).toBe(true);
    expect(inQuietHours(DEFAULT_SETTINGS, 3 * 60)).toBe(true);
    expect(inQuietHours(DEFAULT_SETTINGS, 8 * 60)).toBe(false);
  });

  it('fenêtre dans la journée, désactivée, ou vide', () => {
    const day = { ...DEFAULT_SETTINGS, quietStart: 13 * 60, quietEnd: 14 * 60 };
    expect(inQuietHours(day, 13 * 60 + 30)).toBe(true);
    expect(inQuietHours(day, 14 * 60)).toBe(false);
    expect(inQuietHours({ ...day, quietEnabled: false }, 13 * 60 + 30)).toBe(false);
    expect(inQuietHours({ ...day, quietEnd: 13 * 60 }, 13 * 60)).toBe(false);
  });

  it('la push née pendant les heures calmes part à leur fin, heure du profil', () => {
    // 23 h 30 à Paris (UTC+1 en hiver) : la push part à 8 h, heure de Paris, soit 7 h UTC.
    const now = new Date('2026-12-01T22:30:00Z');
    expect(localMinutes(now, 'Europe/Paris')).toBe(23 * 60 + 30);
    expect(pushDueAt(now, DEFAULT_SETTINGS, 'Europe/Paris').toISOString()).toBe(
      '2026-12-02T07:00:00.000Z',
    );
    const noon = new Date('2026-12-01T11:00:00Z');
    expect(pushDueAt(noon, DEFAULT_SETTINGS, 'Europe/Paris')).toEqual(noon);
  });
});

describe('NOT-04, NOT-12 : canaux', () => {
  it('défauts de NOT-12, écarts du profil, sécurité jamais désactivée', () => {
    expect(channelEnabled([], 'EXTRACTION', 'PUSH')).toBe(false);
    expect(channelEnabled([], 'COMMENTS', 'PUSH')).toBe(true);
    const off = [{ category: 'COMMENTS' as const, channel: 'PUSH' as const, enabled: false }];
    expect(channelEnabled(off, 'COMMENTS', 'PUSH')).toBe(false);
    const security = [{ category: 'SECURITY' as const, channel: 'PUSH' as const, enabled: false }];
    expect(channelEnabled(security, 'SECURITY', 'PUSH')).toBe(true);
  });
});
