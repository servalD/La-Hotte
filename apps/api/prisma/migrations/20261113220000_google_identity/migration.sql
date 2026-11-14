-- AUTH-03 : une seule identité Google par compte. L'unicité, plutôt qu'un contrôle applicatif,
-- tranche deux associations concurrentes du même compte.
CREATE UNIQUE INDEX "auth_identity_account_id_provider_key" ON "auth_identity"("account_id", "provider");

-- `sub` d'OpenID Connect : 255 caractères ASCII au plus (OIDC Core, 2), jamais vide.
ALTER TABLE "auth_identity"
    ADD CONSTRAINT "auth_identity_subject_format" CHECK ("subject" ~ '^[\x21-\x7e]{1,255}$');
