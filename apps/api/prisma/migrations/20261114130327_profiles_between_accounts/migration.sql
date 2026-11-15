-- PRO-10 à PRO-16, LNK-11 : profils entre comptes (tranche 6 bis de la phase 1, lot a).
-- Les valeurs d'enum ajoutées par `ADD VALUE` ne peuvent pas servir dans la même transaction :
-- les contraintes de la fin les comparent en `::text`.
-- CreateEnum
CREATE TYPE "link_origin" AS ENUM ('INVITATION', 'TRANSFER', 'GUARDIANSHIP');

-- CreateEnum
CREATE TYPE "transfer_kind" AS ENUM ('MOVE', 'DETACH', 'WARD');

-- CreateEnum
CREATE TYPE "transfer_pin_choice" AS ENUM ('KEEP', 'NEW', 'NONE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "account_token_purpose" ADD VALUE 'PROFILE_EMAIL_VERIFY';
ALTER TYPE "account_token_purpose" ADD VALUE 'TRANSFER_CONSENT';
ALTER TYPE "account_token_purpose" ADD VALUE 'TRANSFER_CANCEL';

-- AlterEnum
ALTER TYPE "invitation_kind" ADD VALUE 'PROFILE';

-- AlterTable
ALTER TABLE "account" ADD COLUMN     "guardian_account_id" UUID,
ADD COLUMN     "guardian_attested_at" TIMESTAMPTZ(3),
ADD COLUMN     "guardian_release_requested_at" TIMESTAMPTZ(3),
ALTER COLUMN "age_attested_at" DROP NOT NULL;

-- AlterTable
ALTER TABLE "account_token" ADD COLUMN     "profile_id" UUID,
ADD COLUMN     "transfer_id" UUID;

-- AlterTable
ALTER TABLE "invitation" ADD COLUMN     "profile_is_child" BOOLEAN,
ADD COLUMN     "target_accepted_at" TIMESTAMPTZ(3),
ADD COLUMN     "target_refused_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "profile" ADD COLUMN     "child_changed_at" TIMESTAMPTZ(3),
ADD COLUMN     "child_notice_at" TIMESTAMPTZ(3),
ADD COLUMN     "email" VARCHAR(254),
ADD COLUMN     "email_verified_at" TIMESTAMPTZ(3),
ADD COLUMN     "pin_reset_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "profile_link" ADD COLUMN     "origin" "link_origin" NOT NULL DEFAULT 'INVITATION';

-- AlterTable
ALTER TABLE "security_log" ADD COLUMN     "profile_id" UUID,
ADD COLUMN     "transfer_id" UUID;

-- CreateTable
CREATE TABLE "profile_transfer" (
    "id" UUID NOT NULL,
    "kind" "transfer_kind" NOT NULL,
    "profile_id" UUID,
    "new_profile_name" VARCHAR(60),
    "from_account_id" UUID NOT NULL,
    "to_account_id" UUID,
    "new_email" VARCHAR(254),
    "token_hash" CHAR(64) NOT NULL,
    "profile_consent_required" BOOLEAN NOT NULL,
    "regroup" BOOLEAN NOT NULL DEFAULT false,
    "from_accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "profile_accepted_at" TIMESTAMPTZ(3),
    "to_accepted_at" TIMESTAMPTZ(3),
    "pin_choice" "transfer_pin_choice" NOT NULL,
    "new_pin_hash" VARCHAR(255),
    "executes_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "profile_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profile_transfer_token_hash_key" ON "profile_transfer"("token_hash");

-- CreateIndex
CREATE INDEX "profile_transfer_from_account_id_idx" ON "profile_transfer"("from_account_id");

-- CreateIndex
CREATE INDEX "profile_transfer_to_account_id_idx" ON "profile_transfer"("to_account_id");

-- CreateIndex
CREATE INDEX "profile_transfer_executes_at_idx" ON "profile_transfer"("executes_at");

-- CreateIndex
CREATE INDEX "account_guardian_account_id_idx" ON "account"("guardian_account_id");

-- CreateIndex
CREATE INDEX "account_token_profile_id_idx" ON "account_token"("profile_id");

-- CreateIndex
CREATE INDEX "account_token_transfer_id_idx" ON "account_token"("transfer_id");

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_guardian_account_id_fkey" FOREIGN KEY ("guardian_account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_token" ADD CONSTRAINT "account_token_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_token" ADD CONSTRAINT "account_token_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "profile_transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_transfer" ADD CONSTRAINT "profile_transfer_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_transfer" ADD CONSTRAINT "profile_transfer_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_transfer" ADD CONSTRAINT "profile_transfer_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- DAT-01 : contraintes que le schéma Prisma ne sait pas décrire.

-- AUTH-08, PRO-15, RGPD-06 : un compte déclare son âge, sauf sous tutelle, où le tuteur déclare
-- l'autorité parentale. Rôle USER seul sous tutelle ; pas de tutelle sur soi-même.
ALTER TABLE "account"
    ADD CONSTRAINT "account_age_or_guardian" CHECK (
        "age_attested_at" IS NOT NULL
        OR ("guardian_account_id" IS NOT NULL AND "guardian_attested_at" IS NOT NULL)),
    ADD CONSTRAINT "account_guardian_attested" CHECK (
        "guardian_account_id" IS NULL OR "guardian_attested_at" IS NOT NULL),
    ADD CONSTRAINT "account_guardian_not_self" CHECK ("guardian_account_id" <> "id"),
    ADD CONSTRAINT "account_ward_role_user" CHECK ("guardian_account_id" IS NULL OR "role" = 'USER'),
    ADD CONSTRAINT "account_release_needs_guardian" CHECK (
        "guardian_release_requested_at" IS NULL OR "guardian_account_id" IS NOT NULL);

-- PRO-10 : adresse facultative du profil, normalisée, absente pour un enfant ; vérifiée seulement
-- si elle existe.
ALTER TABLE "profile"
    ADD CONSTRAINT "profile_email_normalized" CHECK (
        "email" IS NULL OR ("email" = lower(btrim("email")) AND "email" LIKE '%_@_%')),
    ADD CONSTRAINT "profile_email_not_child" CHECK ("email" IS NULL OR NOT "is_child"),
    ADD CONSTRAINT "profile_email_verified_needs_email" CHECK (
        "email_verified_at" IS NULL OR "email" IS NOT NULL);

-- PRO-10, PRO-12 : les jetons d'un profil portent le profil, ceux d'un passage la demande ;
-- `PROFILE_EMAIL_VERIFY` porte l'adresse à vérifier.
ALTER TABLE "account_token" DROP CONSTRAINT "account_token_new_email";
ALTER TABLE "account_token"
    ADD CONSTRAINT "account_token_new_email" CHECK (
        CASE "purpose"::text
            WHEN 'EMAIL_CHANGE' THEN "new_email" IS NOT NULL
            WHEN 'PROFILE_EMAIL_VERIFY' THEN "new_email" IS NOT NULL
            WHEN 'EMAIL_CHANGE_CANCEL' THEN TRUE
            ELSE "new_email" IS NULL
        END),
    ADD CONSTRAINT "account_token_profile_scope" CHECK (
        CASE "purpose"::text
            WHEN 'PROFILE_EMAIL_VERIFY' THEN "profile_id" IS NOT NULL AND "transfer_id" IS NULL
            WHEN 'TRANSFER_CONSENT' THEN "profile_id" IS NOT NULL AND "transfer_id" IS NOT NULL
            WHEN 'TRANSFER_CANCEL' THEN "profile_id" IS NOT NULL AND "transfer_id" IS NOT NULL
            ELSE "profile_id" IS NULL AND "transfer_id" IS NULL
        END);

-- PRO-11 : une invitation `PROFILE` porte le marqueur du profil à créer, et elle seule ;
-- acceptée ou refusée par le compte visé, jamais les deux.
ALTER TABLE "invitation"
    ADD CONSTRAINT "invitation_profile_fields" CHECK (
        ("kind"::text = 'PROFILE') = ("profile_is_child" IS NOT NULL)
        AND ("kind"::text = 'PROFILE' OR ("target_accepted_at" IS NULL AND "target_refused_at" IS NULL))),
    ADD CONSTRAINT "invitation_target_decided_once" CHECK (
        "target_accepted_at" IS NULL OR "target_refused_at" IS NULL);

-- LNK-11, PRO-15 : un lien né d'un passage ou de la tutelle est accepté d'office, l'accord du
-- compte valant validation des côtés enfants (sans validateur nommé).
ALTER TABLE "profile_link" DROP CONSTRAINT "profile_link_accepted_is_approved";
ALTER TABLE "profile_link"
    ADD CONSTRAINT "profile_link_accepted_is_approved" CHECK (
        "status" <> 'ACCEPTED' OR "origin" <> 'INVITATION' OR (
            (NOT "a_guardian_required" OR "a_guardian_approved_by" IS NOT NULL)
            AND (NOT "b_guardian_required" OR "b_guardian_approved_by" IS NOT NULL)
        )),
    ADD CONSTRAINT "profile_link_non_invitation_accepted" CHECK (
        "origin" = 'INVITATION' OR "status" = 'ACCEPTED');

-- PRO-12, PRO-13, PRO-15 : forme d'une demande de changement de compte.
ALTER TABLE "profile_transfer"
    ADD CONSTRAINT "profile_transfer_token_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "profile_transfer_profile_or_new" CHECK (
        CASE
            WHEN "profile_id" IS NOT NULL THEN "new_profile_name" IS NULL
            ELSE "kind" = 'WARD' AND "new_profile_name" IS NOT NULL
                 AND length(btrim("new_profile_name")) > 0
        END),
    ADD CONSTRAINT "profile_transfer_not_to_self" CHECK ("to_account_id" <> "from_account_id"),
    ADD CONSTRAINT "profile_transfer_new_email" CHECK (
        CASE "kind"
            WHEN 'MOVE' THEN "new_email" IS NULL
            ELSE "new_email" IS NOT NULL AND "new_email" = lower(btrim("new_email"))
                 AND "new_email" LIKE '%_@_%'
        END),
    ADD CONSTRAINT "profile_transfer_regroup_move_only" CHECK (NOT "regroup" OR "kind" = 'MOVE'),
    -- Le nouveau PIN est saisi à l'accord du profil (ou avec la demande pour un enfant) et effacé
    -- à l'exécution ou à l'annulation : seule son absence hors `NEW` est un invariant.
    ADD CONSTRAINT "profile_transfer_new_pin" CHECK ("pin_choice" = 'NEW' OR "new_pin_hash" IS NULL),
    ADD CONSTRAINT "profile_transfer_consent_given_if_required" CHECK (
        "profile_accepted_at" IS NULL OR "profile_consent_required"),
    ADD CONSTRAINT "profile_transfer_ended_once" CHECK (
        "completed_at" IS NULL OR "cancelled_at" IS NULL),
    ADD CONSTRAINT "profile_transfer_completed_has_target" CHECK (
        "completed_at" IS NULL OR "to_account_id" IS NOT NULL),
    ADD CONSTRAINT "profile_transfer_expiry_after_creation" CHECK ("expires_at" > "created_at");

-- PRO-12 : une seule demande ouverte par profil.
CREATE UNIQUE INDEX "profile_transfer_one_open_per_profile" ON "profile_transfer"("profile_id")
    WHERE "completed_at" IS NULL AND "cancelled_at" IS NULL;

-- PRO-11, PRO-14, PRO-16 : les noms d'événement peuvent commencer par un mot composé
-- (`profile_invitation.created`).
ALTER TABLE "security_log" DROP CONSTRAINT "security_log_event_format";
ALTER TABLE "security_log"
    ADD CONSTRAINT "security_log_event_format" CHECK ("event" ~ '^[a-z]+(_[a-z]+)*(\.[a-z_]+)+$');

-- PRO-15 : tout profil d'un compte sous tutelle est un enfant. Le compte est lu sous verrou
-- partagé : une mise sous tutelle concurrente (déclencheur suivant, verrou exclusif de la ligne)
-- attend la fin de la transaction, ou la précède.
CREATE FUNCTION "profile_ward_is_child"() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    ward_of UUID;
BEGIN
    IF NEW."is_child" THEN
        RETURN NEW;
    END IF;
    SELECT "guardian_account_id" INTO ward_of FROM "account"
    WHERE "id" = NEW."account_id"
    FOR SHARE;
    IF ward_of IS NOT NULL THEN
        RAISE EXCEPTION 'adult profile in a ward account' USING ERRCODE = 'check_violation',
            CONSTRAINT = 'profile_ward_is_child';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER "profile_ward_is_child"
    BEFORE INSERT OR UPDATE OF "is_child", "account_id" ON "profile"
    FOR EACH ROW EXECUTE FUNCTION "profile_ward_is_child"();

-- PRO-15 : pas de chaîne de tutelle (le tuteur n'est pas sous tutelle, un compte qui a des comptes
-- sous tutelle n'y passe pas), et un compte ne passe sous tutelle qu'avec des profils enfants.
-- Le tuteur est lu sous verrou partagé : sa propre mise sous tutelle attend.
CREATE FUNCTION "account_guardianship_rules"() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    guardian_of_guardian UUID;
BEGIN
    IF NEW."guardian_account_id" IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW."guardian_account_id" IS NOT DISTINCT FROM OLD."guardian_account_id" THEN
        RETURN NEW;
    END IF;
    SELECT "guardian_account_id" INTO guardian_of_guardian FROM "account"
    WHERE "id" = NEW."guardian_account_id"
    FOR SHARE;
    IF guardian_of_guardian IS NOT NULL THEN
        RAISE EXCEPTION 'guardian account is itself a ward' USING ERRCODE = 'check_violation',
            CONSTRAINT = 'account_guardianship_rules';
    END IF;
    IF EXISTS (SELECT 1 FROM "account" WHERE "guardian_account_id" = NEW."id") THEN
        RAISE EXCEPTION 'guardian account cannot become a ward' USING ERRCODE = 'check_violation',
            CONSTRAINT = 'account_guardianship_rules';
    END IF;
    IF EXISTS (SELECT 1 FROM "profile" WHERE "account_id" = NEW."id" AND NOT "is_child") THEN
        RAISE EXCEPTION 'ward account with an adult profile' USING ERRCODE = 'check_violation',
            CONSTRAINT = 'account_guardianship_rules';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER "account_guardianship_rules"
    BEFORE INSERT OR UPDATE OF "guardian_account_id" ON "account"
    FOR EACH ROW EXECUTE FUNCTION "account_guardianship_rules"();
