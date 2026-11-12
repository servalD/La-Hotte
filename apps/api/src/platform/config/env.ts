import { z } from 'zod';

/** Variables d'environnement validées au démarrage. Aucune valeur n'est journalisée (SEC-21). */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  WEB_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // On nomme les variables fautives, jamais leur valeur.
    const names = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Configuration invalide : ${names}`);
  }
  return result.data;
}

/** Jeton d'injection de la configuration. */
export abstract class AppConfig {
  abstract readonly env: Env;
}
