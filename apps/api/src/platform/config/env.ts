import { z } from 'zod';
import { telemetryEnvShape } from '../telemetry/telemetry-env';

/** Variables d'environnement validées au démarrage. Aucune valeur n'est journalisée (SEC-21). */
const envSchema = z.object({
  // Obligatoire, sans valeur par défaut : un déploiement qui l'oublie doit échouer au démarrage
  // plutôt que de s'exécuter en mode développement.
  NODE_ENV: z.enum(['development', 'test', 'production']),
  // Documentation interactive de l'API : développement seulement ET réglage explicite.
  ENABLE_API_DOCS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  WEB_ORIGIN: z.url(),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  // ADR 0013. Secrets de 32 caractères au moins ; des clés distinctes, jamais réutilisées.
  CSRF_SECRET: z.string().min(32),
  KEY_HMAC_SECRET: z.string().min(32),
  // SEC-22, AUTH-11 : trousseau de chiffrement applicatif (secrets TOTP), hors base. Forme
  // `id:clé[,id:clé…]`, `id` entier de 0 à 255, clé de 32 octets en base64 ; la première chiffre,
  // toutes déchiffrent (rotation). L'identifiant 0 est réservé au développement, aux tests et à
  // la CI : la production le refuse.
  SECRET_ENCRYPTION_KEYS: z
    .string()
    .min(1)
    .transform((raw, ctx) => {
      const keys = parseKeyring(raw);
      if (!keys) ctx.addIssue({ code: 'custom', message: 'trousseau invalide' });
      return keys ?? [];
    }),
  // Nombre de mandataires de confiance devant l'API (`trust proxy` d'Express) : 1 en production
  // (Caddy), 0 en développement. Seule source de l'adresse du client (SEC-30).
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  // AUTH-09 : sans valeur par défaut, le choix doit être explicite.
  REGISTRATION_MODE: z.enum(['OPEN', 'INVITE_ONLY']),
  // Envoi d'e-mails (Mailpit en local : smtp://localhost:1025).
  SMTP_URL: z.url().refine((url) => /^smtps?:\/\//.test(url), 'smtp:// ou smtps://'),
  MAIL_FROM: z.email(),
  ...telemetryEnvShape,
});

export type Env = z.infer<typeof envSchema>;

/** Clé du trousseau de chiffrement applicatif (SEC-22). */
export interface EncryptionKey {
  readonly id: number;
  readonly key: Buffer;
}

const KEYRING_ENTRY = /^(\d{1,3}):([A-Za-z0-9+/]{43}=)$/;

/** `null` si une entrée est mal formée, une clé n'a pas 32 octets ou un identifiant est répété. */
export function parseKeyring(raw: string): EncryptionKey[] | null {
  const keys: EncryptionKey[] = [];
  for (const entry of raw.split(',')) {
    const match = KEYRING_ENTRY.exec(entry.trim());
    if (!match?.[1] || !match[2]) return null;
    const id = Number(match[1]);
    const key = Buffer.from(match[2], 'base64');
    if (id > 255 || key.length !== 32 || keys.some((k) => k.id === id)) return null;
    keys.push({ id, key });
  }
  return keys.length > 0 ? keys : null;
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // On nomme les variables fautives, jamais leur valeur.
    const names = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Configuration invalide : ${names}`);
  }
  // Une clé par usage (ADR 0013) : la même valeur pour les deux secrets est refusée.
  if (result.data.CSRF_SECRET === result.data.KEY_HMAC_SECRET) {
    throw new Error('Configuration invalide : CSRF_SECRET, KEY_HMAC_SECRET');
  }
  if (result.data.NODE_ENV === 'production') {
    const invalid = productionProblems(source, result.data);
    if (invalid.length > 0) throw new Error(`Configuration invalide : ${invalid.join(', ')}`);
  }
  return result.data;
}

/** Valeurs de développement, de test ou de CI : jamais en production. */
const NON_PRODUCTION_SECRET = /^(dev|test|ci)-only-|^test-/;

/**
 * Production : `TRUSTED_PROXY_HOPS` explicite (sinon l'adresse de Caddy serait celle de tous les
 * clients, et le compteur par IP deviendrait global) ; secrets qui ne sont pas ceux des fichiers
 * d'exemple ; SMTP chiffré (`smtps://`, ou `smtp://` avec `requireTLS=true`).
 */
function productionProblems(source: NodeJS.ProcessEnv, env: Env): string[] {
  const problems: string[] = [];
  if (source.TRUSTED_PROXY_HOPS === undefined || source.TRUSTED_PROXY_HOPS === '') {
    problems.push('TRUSTED_PROXY_HOPS');
  }
  if (NON_PRODUCTION_SECRET.test(env.CSRF_SECRET)) problems.push('CSRF_SECRET');
  if (NON_PRODUCTION_SECRET.test(env.KEY_HMAC_SECRET)) problems.push('KEY_HMAC_SECRET');
  if (
    env.SECRET_ENCRYPTION_KEYS.some(
      (k) => k.id === 0 || NON_PRODUCTION_SECRET.test(k.key.toString('latin1')),
    )
  ) {
    problems.push('SECRET_ENCRYPTION_KEYS');
  }
  const smtp = new URL(env.SMTP_URL);
  if (smtp.protocol !== 'smtps:' && smtp.searchParams.get('requireTLS') !== 'true') {
    problems.push('SMTP_URL');
  }
  return problems;
}

/** Jeton d'injection de la configuration. */
export abstract class AppConfig {
  abstract readonly env: Env;
}
