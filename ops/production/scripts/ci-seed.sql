-- Données d'essai de la restauration chronométrée (job `restore` de la CI). Fictives, sans valeur
-- ailleurs : 1 000 comptes, un profil et 5 fiches chacun, et des entrées d'audit.
INSERT INTO account (id, email, email_verified_at, age_attested_at, updated_at)
SELECT gen_random_uuid(), 'essai-' || n || '@lahotte.test', now(), now(), now()
FROM generate_series(1, 1000) AS n;

INSERT INTO profile (id, account_id, display_name, accent_color, locale, currency, timezone, updated_at)
SELECT gen_random_uuid(), a.id, 'Profil', '#336699', 'fr', 'EUR', 'Europe/Paris', now()
FROM account a WHERE a.email LIKE 'essai-%';

INSERT INTO product (id, owner_profile_id, title, currency, source, updated_at)
SELECT gen_random_uuid(), p.id, 'Fiche ' || n, 'EUR', 'MANUAL', now()
FROM profile p, generate_series(1, 5) AS n;

INSERT INTO audit_log (id, action, reason)
SELECT gen_random_uuid(), 'audit.read', NULL FROM generate_series(1, 200);
