-- Développement local et CI uniquement. Exécuté par l'image postgres au premier démarrage.
-- DAT-03 : deux rôles. « wishlist » (propriétaire, migrations) est créé par l'image ;
-- « wishlist_app » lit et écrit, sans aucun droit sur le schéma.

CREATE ROLE wishlist_app LOGIN PASSWORD 'wishlist_app';
CREATE DATABASE wishlist_shadow OWNER wishlist;

GRANT CONNECT ON DATABASE wishlist TO wishlist_app;
GRANT USAGE ON SCHEMA public TO wishlist_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE wishlist IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wishlist_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wishlist IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO wishlist_app;
