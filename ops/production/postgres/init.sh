#!/bin/sh
# DAT-03 : rôles de la base de production, au premier démarrage du conteneur. « wishlist »
# (propriétaire, migrations) est créé par l'image ; « wishlist_app » lit et écrit, sans aucun droit
# sur le schéma. Le mot de passe vient de l'environnement (APP_DB_PASSWORD), jamais du dépôt.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE wishlist_app LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE wishlist TO wishlist_app;
GRANT USAGE ON SCHEMA public TO wishlist_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE wishlist IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wishlist_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wishlist IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO wishlist_app;
SQL
