-- Phase 2 : fiches article, listes, éléments, règles de visibilité, cache d'extraction.
-- CreateEnum
CREATE TYPE "product_source" AS ENUM ('LINK', 'PHOTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "share_level" AS ENUM ('PRIVATE', 'CIRCLE', 'GLOBAL');

-- CreateEnum
CREATE TYPE "moderation_status" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "extraction_status" AS ENUM ('NONE', 'PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "list_type" AS ENUM ('WISHLIST', 'GIFTLIST');

-- CreateEnum
CREATE TYPE "list_audience" AS ENUM ('MEMBERS', 'CIRCLE', 'EVENT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "list_role" AS ENUM ('CREATOR', 'OWNER', 'CONTRIBUTOR', 'READER');

-- CreateEnum
CREATE TYPE "visibility_edit_role" AS ENUM ('CREATOR', 'OWNER', 'CONTRIBUTOR');

-- CreateEnum
CREATE TYPE "gift_existence" AS ENUM ('HIDDEN', 'REVEALED');

-- CreateEnum
CREATE TYPE "gift_content" AS ENUM ('NONE', 'PARTIAL', 'FULL');

-- CreateEnum
CREATE TYPE "visibility_mode" AS ENUM ('ALL', 'ONLY', 'EXCEPT');

-- CreateEnum
CREATE TYPE "item_priority" AS ENUM ('WANT', 'LOVE', 'MUST');

-- CreateEnum
CREATE TYPE "item_status" AS ENUM ('OPEN', 'RESERVED', 'PURCHASED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "withdrawn_reason" AS ENUM ('ALREADY_HAVE', 'NO_LONGER_WANTED');

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "owner_profile_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "image_key" CHAR(32),
    "image_from_photo" BOOLEAN NOT NULL DEFAULT false,
    "unit_price_minor" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "merchant" VARCHAR(120),
    "source_url" VARCHAR(2048),
    "normalized_url" VARCHAR(2048),
    "source" "product_source" NOT NULL,
    "share_level" "share_level" NOT NULL DEFAULT 'PRIVATE',
    "moderation_status" "moderation_status" NOT NULL DEFAULT 'NONE',
    "extraction_status" "extraction_status" NOT NULL DEFAULT 'NONE',
    "extraction_started_at" TIMESTAMPTZ(3),
    "uncertain_fields" VARCHAR(32)[] DEFAULT ARRAY[]::VARCHAR(32)[],
    "extraction_truncated" BOOLEAN NOT NULL DEFAULT false,
    "price_checked_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "list" (
    "id" UUID NOT NULL,
    "type" "list_type" NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000) NOT NULL DEFAULT '',
    "creator_profile_id" UUID,
    "personal_profile_id" UUID,
    "event_id" UUID,
    "audience" "list_audience" NOT NULL,
    "default_item_visibility" "visibility_mode" NOT NULL DEFAULT 'ALL',
    "visibility_edit_role" "visibility_edit_role" NOT NULL DEFAULT 'CREATOR',
    "gift_existence" "gift_existence" NOT NULL DEFAULT 'HIDDEN',
    "gift_content" "gift_content" NOT NULL DEFAULT 'NONE',
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "list_recipient" (
    "id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "list_recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "list_member" (
    "id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "role" "list_role" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "list_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "list_audience_profile" (
    "id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "list_audience_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "list_item" (
    "id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "added_by_profile_id" UUID,
    "intended_recipient_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_minor" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "priority" "item_priority" NOT NULL DEFAULT 'WANT',
    "note" VARCHAR(500) NOT NULL DEFAULT '',
    "many_welcome" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "visibility_mode" "visibility_mode" NOT NULL DEFAULT 'ALL',
    "status" "item_status" NOT NULL DEFAULT 'OPEN',
    "withdrawn_reason" "withdrawn_reason",
    "is_suggestion" BOOLEAN NOT NULL DEFAULT false,
    "shown_to_recipient" BOOLEAN NOT NULL DEFAULT false,
    "received_at" TIMESTAMPTZ(3),
    "carried_from_item_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "list_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_visibility_profile" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "item_visibility_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visibility_change_log" (
    "id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "item_id" UUID,
    "changed_by" UUID NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visibility_change_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_cache" (
    "id" UUID NOT NULL,
    "normalized_url" VARCHAR(2048) NOT NULL,
    "result" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "extraction_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_owner_profile_id_idx" ON "product"("owner_profile_id");

-- CreateIndex
CREATE INDEX "product_normalized_url_idx" ON "product"("normalized_url");

-- CreateIndex
CREATE INDEX "product_share_level_idx" ON "product"("share_level");

-- CreateIndex
CREATE UNIQUE INDEX "list_personal_profile_id_key" ON "list"("personal_profile_id");

-- CreateIndex
CREATE INDEX "list_creator_profile_id_idx" ON "list"("creator_profile_id");

-- CreateIndex
CREATE INDEX "list_deleted_at_idx" ON "list"("deleted_at");

-- CreateIndex
CREATE INDEX "list_recipient_profile_id_idx" ON "list_recipient"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "list_recipient_list_id_profile_id_key" ON "list_recipient"("list_id", "profile_id");

-- CreateIndex
CREATE INDEX "list_member_profile_id_idx" ON "list_member"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "list_member_list_id_profile_id_key" ON "list_member"("list_id", "profile_id");

-- CreateIndex
CREATE INDEX "list_audience_profile_profile_id_idx" ON "list_audience_profile"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "list_audience_profile_list_id_profile_id_key" ON "list_audience_profile"("list_id", "profile_id");

-- CreateIndex
CREATE INDEX "list_item_list_id_position_idx" ON "list_item"("list_id", "position");

-- CreateIndex
CREATE INDEX "list_item_product_id_idx" ON "list_item"("product_id");

-- CreateIndex
CREATE INDEX "list_item_added_by_profile_id_idx" ON "list_item"("added_by_profile_id");

-- CreateIndex
CREATE INDEX "item_visibility_profile_profile_id_idx" ON "item_visibility_profile"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "item_visibility_profile_item_id_profile_id_key" ON "item_visibility_profile"("item_id", "profile_id");

-- CreateIndex
CREATE INDEX "visibility_change_log_list_id_at_idx" ON "visibility_change_log"("list_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "extraction_cache_normalized_url_key" ON "extraction_cache"("normalized_url");

-- CreateIndex
CREATE INDEX "extraction_cache_expires_at_idx" ON "extraction_cache"("expires_at");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list" ADD CONSTRAINT "list_creator_profile_id_fkey" FOREIGN KEY ("creator_profile_id") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list" ADD CONSTRAINT "list_personal_profile_id_fkey" FOREIGN KEY ("personal_profile_id") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_recipient" ADD CONSTRAINT "list_recipient_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_recipient" ADD CONSTRAINT "list_recipient_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_member" ADD CONSTRAINT "list_member_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_member" ADD CONSTRAINT "list_member_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_audience_profile" ADD CONSTRAINT "list_audience_profile_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_audience_profile" ADD CONSTRAINT "list_audience_profile_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_item" ADD CONSTRAINT "list_item_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_item" ADD CONSTRAINT "list_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_item" ADD CONSTRAINT "list_item_added_by_profile_id_fkey" FOREIGN KEY ("added_by_profile_id") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_item" ADD CONSTRAINT "list_item_intended_recipient_id_fkey" FOREIGN KEY ("intended_recipient_id") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_visibility_profile" ADD CONSTRAINT "item_visibility_profile_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "list_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_visibility_profile" ADD CONSTRAINT "item_visibility_profile_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Contraintes écrites à la main (DAT-01, DAT-02), phase 2.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "product" ALTER COLUMN "uncertain_fields" SET NOT NULL;
ALTER TABLE "product" ADD CONSTRAINT "product_title_not_blank" CHECK (length(btrim("title")) > 0);
ALTER TABLE "product" ADD CONSTRAINT "product_price_non_negative" CHECK ("unit_price_minor" IS NULL OR "unit_price_minor" >= 0);
ALTER TABLE "product" ADD CONSTRAINT "product_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "product" ADD CONSTRAINT "product_image_key_hex" CHECK ("image_key" IS NULL OR "image_key" ~ '^[0-9a-f]{32}$');
-- REP-04 : une photo de l'utilisateur ne va jamais au catalogue global.
ALTER TABLE "product" ADD CONSTRAINT "product_global_no_photo" CHECK ("share_level" <> 'GLOBAL' OR NOT "image_from_photo");

-- VIS-40 : recherche plein texte, champs non soumis à la règle de surprise.
CREATE INDEX "product_search_idx" ON "product"
  USING GIN (to_tsvector('french', "title" || ' ' || "description"));

ALTER TABLE "list" ADD CONSTRAINT "list_title_not_blank" CHECK (length(btrim("title")) > 0);
-- GFT-04
ALTER TABLE "list" ADD CONSTRAINT "list_gift_content_revealed" CHECK ("gift_content" = 'NONE' OR "gift_existence" = 'REVEALED');
-- WSH-06
ALTER TABLE "list" ADD CONSTRAINT "list_personal_is_wishlist" CHECK ("personal_profile_id" IS NULL OR "type" = 'WISHLIST');

-- LST-02 : un seul créateur par liste.
CREATE UNIQUE INDEX "list_member_one_creator" ON "list_member"("list_id") WHERE "role" = 'CREATOR';

ALTER TABLE "list_item" ADD CONSTRAINT "list_item_quantity_positive" CHECK ("quantity" >= 1);
ALTER TABLE "list_item" ADD CONSTRAINT "list_item_price_non_negative" CHECK ("unit_price_minor" IS NULL OR "unit_price_minor" >= 0);
ALTER TABLE "list_item" ADD CONSTRAINT "list_item_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "list_item" ADD CONSTRAINT "list_item_withdrawn_reason" CHECK (("status" = 'WITHDRAWN') = ("withdrawn_reason" IS NOT NULL));
CREATE INDEX "list_item_open_idx" ON "list_item"("list_id") WHERE "status" <> 'WITHDRAWN';

-- GFT-01, LST-08 : un destinataire de giftlist n'est jamais membre ; WSH-04 : suggestion sur une
-- wishlist seulement. Verrou partagé sur la liste : deux insertions concurrentes (membre et
-- destinataire) se sérialisent avec un changement de type.
CREATE FUNCTION "list_gift_recipient_not_member"() RETURNS trigger AS $$
DECLARE
  list_kind "list_type";
BEGIN
  SELECT "type" INTO list_kind FROM "list" WHERE "id" = NEW."list_id" FOR SHARE;
  IF list_kind = 'GIFTLIST' THEN
    IF TG_TABLE_NAME = 'list_member' AND EXISTS (
      SELECT 1 FROM "list_recipient" WHERE "list_id" = NEW."list_id" AND "profile_id" = NEW."profile_id"
    ) THEN
      RAISE EXCEPTION 'giftlist recipient cannot be a member' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'list_recipient' AND EXISTS (
      SELECT 1 FROM "list_member" WHERE "list_id" = NEW."list_id" AND "profile_id" = NEW."profile_id"
    ) THEN
      RAISE EXCEPTION 'giftlist member cannot be a recipient' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "list_member_not_gift_recipient" BEFORE INSERT OR UPDATE ON "list_member"
  FOR EACH ROW EXECUTE FUNCTION "list_gift_recipient_not_member"();
CREATE TRIGGER "list_recipient_not_gift_member" BEFORE INSERT OR UPDATE ON "list_recipient"
  FOR EACH ROW EXECUTE FUNCTION "list_gift_recipient_not_member"();

CREATE FUNCTION "list_item_suggestion_on_wishlist"() RETURNS trigger AS $$
BEGIN
  IF NEW."is_suggestion" AND NOT EXISTS (
    SELECT 1 FROM "list" WHERE "id" = NEW."list_id" AND "type" = 'WISHLIST'
  ) THEN
    RAISE EXCEPTION 'suggestion only on a wishlist' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "list_item_suggestion_on_wishlist" BEFORE INSERT OR UPDATE ON "list_item"
  FOR EACH ROW EXECUTE FUNCTION "list_item_suggestion_on_wishlist"();

-- Le type d'une liste ne change pas (les règles ci-dessus sont vérifiées à l'insertion).
CREATE FUNCTION "list_type_immutable"() RETURNS trigger AS $$
BEGIN
  IF NEW."type" <> OLD."type" THEN
    RAISE EXCEPTION 'list type is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "list_type_immutable" BEFORE UPDATE ON "list"
  FOR EACH ROW EXECUTE FUNCTION "list_type_immutable"();

-- PRO-06, LST-04 : suppression d'un profil. Avant les cascades : « Mes envies » passe à la corbeille
-- (LST-20) ; une liste dont il est le créateur garde un responsable (le plus ancien contributeur
-- est promu s'il n'y en a pas), ou est archivée faute de membre.
CREATE FUNCTION "profile_deletion_lists"() RETURNS trigger AS $$
DECLARE
  l RECORD;
  heir UUID;
BEGIN
  UPDATE "list" SET "deleted_at" = COALESCE("deleted_at", now()), "updated_at" = now()
   WHERE "personal_profile_id" = OLD."id";

  FOR l IN SELECT "id" FROM "list" WHERE "creator_profile_id" = OLD."id" AND "personal_profile_id" IS DISTINCT FROM OLD."id" FOR UPDATE LOOP
    IF NOT EXISTS (
      SELECT 1 FROM "list_member" WHERE "list_id" = l."id" AND "role" = 'OWNER' AND "profile_id" <> OLD."id"
    ) THEN
      SELECT "id" INTO heir FROM "list_member"
       WHERE "list_id" = l."id" AND "role" = 'CONTRIBUTOR' AND "profile_id" <> OLD."id"
       ORDER BY "created_at", "id" LIMIT 1;
      IF heir IS NULL THEN
        UPDATE "list" SET "archived_at" = COALESCE("archived_at", now()), "updated_at" = now() WHERE "id" = l."id";
      ELSE
        UPDATE "list_member" SET "role" = 'OWNER', "updated_at" = now() WHERE "id" = heir;
      END IF;
    END IF;
  END LOOP;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "profile_deletion_lists" BEFORE DELETE ON "profile"
  FOR EACH ROW EXECUTE FUNCTION "profile_deletion_lists"();

-- DAT-02 : journal en ajout seul.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wishlist_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "visibility_change_log" FROM wishlist_app;
  END IF;
END
$$;