import { parseEnv } from './env';

const valid = {
  NODE_ENV: 'test',
  WEB_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://u:secret-value@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('parseEnv', () => {
  it('applique les valeurs par défaut', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.ENABLE_API_DOCS).toBe(false);
  });

  it('SEC-21 : NODE_ENV est obligatoire, jamais « development » par défaut', () => {
    const { NODE_ENV: _omitted, ...withoutNodeEnv } = valid;
    expect(() => parseEnv(withoutNodeEnv)).toThrowError(/NODE_ENV/);
  });

  it('la documentation de l’API reste fermée sans réglage explicite', () => {
    expect(parseEnv({ ...valid, NODE_ENV: 'development' }).ENABLE_API_DOCS).toBe(false);
    expect(parseEnv({ ...valid, ENABLE_API_DOCS: 'true' }).ENABLE_API_DOCS).toBe(true);
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
