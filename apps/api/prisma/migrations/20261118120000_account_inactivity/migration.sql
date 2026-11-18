-- AlterTable
ALTER TABLE "account" ADD COLUMN     "inactivity_notices" SMALLINT NOT NULL DEFAULT 0;


-- RGPD-13 : 0, 1 ou 2 avertissements.
ALTER TABLE "account" ADD CONSTRAINT "account_inactivity_notices_range" CHECK ("inactivity_notices" BETWEEN 0 AND 2);
