// Tests d'intégration : variables de apps/api/.env si présent, sinon celles de la CI.
try {
  process.loadEnvFile('.env');
} catch {
  // Variables fournies par l'environnement.
}
process.env.WEB_ORIGIN ??= 'http://localhost:3000';
