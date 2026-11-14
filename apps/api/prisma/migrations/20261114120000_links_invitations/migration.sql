-- LNK-01 à LNK-10, AUTH-09 : liens entre profils, blocages, invitations (tranche 6 de la phase 1).
-- CreateEnum
CREATE TYPE "link_status" AS ENUM ('PENDING', 'AWAITING_GUARDIAN', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "invitation_kind" AS ENUM ('LINK', 'LIST', 'EVENT');

-- AlterTable
ALTER TABLE "account" ADD COLUMN     "pending_invitation_id" UUID;

-- CreateTable
CREATE TABLE "profile_link" (
    "id" UUID NOT NULL,
    "profile_a_id" UUID NOT NULL,
    "profile_b_id" UUID NOT NULL,
    "status" "link_status" NOT NULL,
    "requested_by" UUID NOT NULL,
    "a_guardian_required" BOOLEAN NOT NULL,
    "b_guardian_required" BOOLEAN NOT NULL,
    "a_guardian_approved_by" UUID,
    "b_guardian_approved_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "profile_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_block" (
    "id" UUID NOT NULL,
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "profile_block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" UUID NOT NULL,
    "kind" "invitation_kind" NOT NULL,
    "target_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_by" UUID NOT NULL,
    "max_uses" INTEGER NOT NULL,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profile_link_profile_b_id_idx" ON "profile_link"("profile_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_link_profile_a_id_profile_b_id_key" ON "profile_link"("profile_a_id", "profile_b_id");

-- CreateIndex
CREATE INDEX "profile_block_blocked_id_idx" ON "profile_block"("blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_block_blocker_id_blocked_id_key" ON "profile_block"("blocker_id", "blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation"("token_hash");

-- CreateIndex
CREATE INDEX "invitation_created_by_idx" ON "invitation"("created_by");

-- CreateIndex
CREATE INDEX "invitation_expires_at_idx" ON "invitation"("expires_at");

-- CreateIndex
CREATE INDEX "account_pending_invitation_id_idx" ON "account"("pending_invitation_id");

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_pending_invitation_id_fkey" FOREIGN KEY ("pending_invitation_id") REFERENCES "invitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_link" ADD CONSTRAINT "profile_link_profile_a_id_fkey" FOREIGN KEY ("profile_a_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_link" ADD CONSTRAINT "profile_link_profile_b_id_fkey" FOREIGN KEY ("profile_b_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_block" ADD CONSTRAINT "profile_block_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_block" ADD CONSTRAINT "profile_block_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- DAT-01 : contraintes que le schéma Prisma ne sait pas décrire.
ALTER TABLE "profile_link"
    ADD CONSTRAINT "profile_link_ordered_pair" CHECK ("profile_a_id" < "profile_b_id"),
    ADD CONSTRAINT "profile_link_requested_by_is_party" CHECK ("requested_by" IN ("profile_a_id", "profile_b_id")),
    ADD CONSTRAINT "profile_link_awaiting_needs_guardian" CHECK (
        "status" <> 'AWAITING_GUARDIAN' OR "a_guardian_required" OR "b_guardian_required"
    ),
    ADD CONSTRAINT "profile_link_approval_only_if_required" CHECK (
        ("a_guardian_approved_by" IS NULL OR "a_guardian_required")
        AND ("b_guardian_approved_by" IS NULL OR "b_guardian_required")
    ),
    ADD CONSTRAINT "profile_link_accepted_is_approved" CHECK (
        "status" <> 'ACCEPTED' OR (
            (NOT "a_guardian_required" OR "a_guardian_approved_by" IS NOT NULL)
            AND (NOT "b_guardian_required" OR "b_guardian_approved_by" IS NOT NULL)
        )
    );

ALTER TABLE "profile_block"
    ADD CONSTRAINT "profile_block_not_self" CHECK ("blocker_id" <> "blocked_id");

ALTER TABLE "invitation"
    ADD CONSTRAINT "invitation_token_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "invitation_max_uses_positive" CHECK ("max_uses" > 0),
    ADD CONSTRAINT "invitation_used_count_bounds" CHECK ("used_count" >= 0 AND "used_count" <= "max_uses"),
    ADD CONSTRAINT "invitation_expiry_after_creation" CHECK ("expires_at" > "created_at");

-- LNK-03 : un lien relie toujours des profils de comptes différents.
CREATE FUNCTION "profile_link_different_accounts"() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT "account_id" FROM "profile" WHERE "id" = NEW."profile_a_id")
        = (SELECT "account_id" FROM "profile" WHERE "id" = NEW."profile_b_id") THEN
        RAISE EXCEPTION 'link between profiles of one account' USING ERRCODE = 'check_violation',
            CONSTRAINT = 'profile_link_different_accounts';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER "profile_link_different_accounts"
    BEFORE INSERT OR UPDATE OF "profile_a_id", "profile_b_id" ON "profile_link"
    FOR EACH ROW EXECUTE FUNCTION "profile_link_different_accounts"();

-- Même règle vue du profil : un profil lié ne peut pas passer dans le compte d'un profil auquel il est lié.
CREATE FUNCTION "profile_account_matches_links"() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "profile_link" l
        JOIN "profile" other ON other."id" = CASE WHEN l."profile_a_id" = NEW."id"
            THEN l."profile_b_id" ELSE l."profile_a_id" END
        WHERE (l."profile_a_id" = NEW."id" OR l."profile_b_id" = NEW."id")
          AND other."account_id" = NEW."account_id"
    ) THEN
        RAISE EXCEPTION 'profile linked to a profile of its new account'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'profile_account_matches_links';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER "profile_account_matches_links"
    BEFORE UPDATE OF "account_id" ON "profile"
    FOR EACH ROW EXECUTE FUNCTION "profile_account_matches_links"();
