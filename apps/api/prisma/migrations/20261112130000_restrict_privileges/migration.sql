-- DAT-02, DAT-03 : le rôle applicatif ne touche ni à l'historique des migrations ni, plus tard,
-- aux tables en ajout seul (ledger_entry, audit_log, security_log, visibility_change_log).
-- Les privilèges par défaut de docker/postgres/init.sql accordent SELECT, INSERT, UPDATE et
-- DELETE sur toute nouvelle table : chaque migration qui crée une table en ajout seul doit
-- donc retirer UPDATE et DELETE à ce rôle (règle écrite dans docs/spec/12, DAT-02).
-- Le rôle n'existe pas dans tous les environnements, et la table d'historique n'existe pas dans
-- la base fantôme de `prisma migrate diff` : on ne retire que si les deux sont présents.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wishlist_app')
     AND to_regclass('_prisma_migrations') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "_prisma_migrations" FROM wishlist_app;
  END IF;
END
$$;
