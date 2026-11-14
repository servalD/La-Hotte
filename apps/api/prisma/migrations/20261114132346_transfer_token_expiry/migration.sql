-- PRO-13, PRO-15 : le lien d'installation vaut 24 heures (renvoyable), la demande 7 jours ; le
-- jeton de passage d'un `MOVE` vaut autant que la demande (`01`, « Valeurs par défaut »).
-- AlterTable
ALTER TABLE "profile_transfer" ADD COLUMN "token_expires_at" TIMESTAMPTZ(3);
UPDATE "profile_transfer" SET "token_expires_at" = "expires_at";
ALTER TABLE "profile_transfer" ALTER COLUMN "token_expires_at" SET NOT NULL;

-- DAT-01 : le jeton ne survit pas à la demande.
ALTER TABLE "profile_transfer"
    ADD CONSTRAINT "profile_transfer_token_within_request" CHECK ("token_expires_at" <= "expires_at");
