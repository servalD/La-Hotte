import { parseEnv } from './env';

const valid = {
  NODE_ENV: 'test',
  WEB_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://u:secret-value@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  CSRF_SECRET: 'c'.repeat(32),
  KEY_HMAC_SECRET: 'k'.repeat(32),
  SECRET_ENCRYPTION_KEYS: `0:${Buffer.alloc(32, 7).toString('base64')}`,
  REGISTRATION_MODE: 'OPEN',
  SMTP_URL: 'smtp://localhost:1025',
  MAIL_FROM: 'noreply@lahotte.test',
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

  it('ADR 0013 : secrets de session obligatoires, longs et distincts', () => {
    const { CSRF_SECRET: _omitted, ...withoutCsrf } = valid;
    expect(() => parseEnv(withoutCsrf)).toThrowError(/CSRF_SECRET/);
    expect(() => parseEnv({ ...valid, KEY_HMAC_SECRET: 'court' })).toThrowError(/KEY_HMAC_SECRET/);
    expect(() => parseEnv({ ...valid, KEY_HMAC_SECRET: valid.CSRF_SECRET })).toThrowError(
      /KEY_HMAC_SECRET/,
    );
  });

  it('AUTH-09 : mode d’inscription explicite ; TRUSTED_PROXY_HOPS à 0 par défaut', () => {
    const { REGISTRATION_MODE: _omitted, ...withoutMode } = valid;
    expect(() => parseEnv(withoutMode)).toThrowError(/REGISTRATION_MODE/);
    expect(parseEnv(valid).TRUSTED_PROXY_HOPS).toBe(0);
  });

  it('ADR 0013 : en production, proxy explicite, secrets réels, SMTP chiffré', () => {
    const production = {
      ...valid,
      NODE_ENV: 'production',
      TRUSTED_PROXY_HOPS: '1',
      CSRF_SECRET: 'p'.repeat(40),
      KEY_HMAC_SECRET: 'q'.repeat(40),
      SMTP_URL: 'smtps://smtp.example:465',
      SECRET_ENCRYPTION_KEYS: `1:${Buffer.alloc(32, 9).toString('base64')}`,
    };
    expect(parseEnv(production).TRUSTED_PROXY_HOPS).toBe(1);
    const { TRUSTED_PROXY_HOPS: _omitted, ...withoutHops } = production;
    expect(() => parseEnv(withoutHops)).toThrowError(/TRUSTED_PROXY_HOPS/);
    expect(() =>
      parseEnv({ ...production, CSRF_SECRET: 'dev-only-csrf-secret-0123456789abcdef' }),
    ).toThrowError(/CSRF_SECRET/);
    expect(() => parseEnv({ ...production, SMTP_URL: 'smtp://smtp.example:25' })).toThrowError(
      /SMTP_URL/,
    );
    expect(
      parseEnv({ ...production, SMTP_URL: 'smtp://smtp.example:587?requireTLS=true' }).SMTP_URL,
    ).toContain('requireTLS');
  });

  it('SEC-22 : trousseau bien formé ; identifiant 0 et clés factices refusés en production', () => {
    const key = (fill: number): string => Buffer.alloc(32, fill).toString('base64');
    const keys = parseEnv({
      ...valid,
      SECRET_ENCRYPTION_KEYS: `2:${key(1)}, 1:${key(2)}`,
    }).SECRET_ENCRYPTION_KEYS;
    expect(keys.map((k) => k.id)).toEqual([2, 1]);
    expect(keys[0]?.key.length).toBe(32);
    for (const invalid of [
      '',
      key(1),
      `1:${Buffer.alloc(16, 1).toString('base64')}`,
      `1:${key(1)},1:${key(2)}`,
      `256:${key(1)}`,
    ]) {
      expect(() => parseEnv({ ...valid, SECRET_ENCRYPTION_KEYS: invalid })).toThrowError(
        /SECRET_ENCRYPTION_KEYS/,
      );
    }
    const production = {
      ...valid,
      NODE_ENV: 'production',
      TRUSTED_PROXY_HOPS: '1',
      CSRF_SECRET: 'p'.repeat(40),
      KEY_HMAC_SECRET: 'q'.repeat(40),
      SMTP_URL: 'smtps://smtp.example:465',
    };
    expect(() => parseEnv({ ...production, SECRET_ENCRYPTION_KEYS: `0:${key(3)}` })).toThrowError(
      /SECRET_ENCRYPTION_KEYS/,
    );
    const devKey = Buffer.from('dev-only-secret-encryption-key-0').toString('base64');
    expect(() => parseEnv({ ...production, SECRET_ENCRYPTION_KEYS: `5:${devKey}` })).toThrowError(
      /SECRET_ENCRYPTION_KEYS/,
    );
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
