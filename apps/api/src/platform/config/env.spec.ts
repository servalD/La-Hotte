import { parseEnv } from './env';

const valid = {
  WEB_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://u:secret-value@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('parseEnv', () => {
  it('applique les valeurs par défaut', () => {
    const env = parseEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
  });

  it('nomme la variable fautive sans jamais afficher de valeur (SEC-21)', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'pas-une-url-secret-value' })).toThrowError(
      /DATABASE_URL/,
    );
    try {
      parseEnv({ ...valid, DATABASE_URL: 'pas-une-url-secret-value' });
    } catch (error) {
      expect(String(error)).not.toContain('secret-value');
    }
  });
});
