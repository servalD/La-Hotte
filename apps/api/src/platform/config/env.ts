import { z } from 'zod';

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
