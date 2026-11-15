-- Tranche 3 de la phase 1 : TOTP, codes de secours, appareils de confiance (AUTH-10 à AUTH-13).

-- AUTH-11 : anti-rejeu. Dernier pas de temps accepté ; un code de ce pas ou d'un pas antérieur
-- est refusé, par un UPDATE conditionnel (deux requêtes concurrentes ne l'acceptent jamais deux fois).
ALTER TABLE "account" ADD COLUMN "totp_last_step" INTEGER;

-- SEC-22 : codes de secours en SHA-256 (64 caractères hexadécimaux), uniques par compte.
DROP INDEX "recovery_code_account_id_idx";
ALTER TABLE "recovery_code" ALTER COLUMN "code_hash" SET DATA TYPE CHAR(64);
CREATE UNIQUE INDEX "recovery_code_account_id_code_hash_key" ON "recovery_code"("account_id", "code_hash");

-- DAT-01.
ALTER TABLE "account"
    ADD CONSTRAINT "account_totp_last_step_non_negative" CHECK ("totp_last_step" IS NULL OR "totp_last_step" >= 0),
    -- Un pas accepté n'existe qu'avec un TOTP actif : la désactivation l'efface avec le secret.
    ADD CONSTRAINT "account_totp_last_step_needs_totp" CHECK ("totp_last_step" IS NULL OR "totp_enabled_at" IS NOT NULL);

ALTER TABLE "recovery_code"
    ADD CONSTRAINT "recovery_code_hash_format" CHECK ("code_hash" ~ '^[0-9a-f]{64}$');
