-- CreateEnum
CREATE TYPE "event_type" AS ENUM ('CHRISTMAS', 'BIRTHDAY', 'BIRTH', 'WEDDING', 'OTHER');

-- CreateEnum
CREATE TYPE "event_mode" AS ENUM ('EXCHANGE', 'HONOREE');

-- CreateEnum
CREATE TYPE "event_status" AS ENUM ('UPCOMING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "event_role" AS ENUM ('ORGANIZER', 'PARTICIPANT');

-- CreateEnum
CREATE TYPE "rsvp" AS ENUM ('PENDING', 'YES', 'MAYBE', 'NO');

-- CreateTable
CREATE TABLE "event" (
    "id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "date" DATE NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "place" VARCHAR(200) NOT NULL DEFAULT '',
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "type" "event_type" NOT NULL,
    "mode" "event_mode" NOT NULL,
    "is_surprise" BOOLEAN NOT NULL DEFAULT false,
    "suggested_budget_minor" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "status" "event_status" NOT NULL DEFAULT 'UPCOMING',
    "created_by" UUID,
    "recreated_from_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_participant" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "role" "event_role" NOT NULL DEFAULT 'PARTICIPANT',
    "is_honoree" BOOLEAN NOT NULL DEFAULT false,
    "rsvp" "rsvp" NOT NULL DEFAULT 'PENDING',
    "responded_at" TIMESTAMPTZ(3),
    "invited_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_surprise_recipient" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_surprise_recipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_status_date_idx" ON "event"("status", "date");

-- CreateIndex
CREATE INDEX "event_participant_profile_id_idx" ON "event_participant"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_participant_event_id_profile_id_key" ON "event_participant"("event_id", "profile_id");

-- CreateIndex
CREATE INDEX "event_surprise_recipient_profile_id_idx" ON "event_surprise_recipient"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_surprise_recipient_event_id_profile_id_key" ON "event_surprise_recipient"("event_id", "profile_id");

-- CreateIndex
CREATE INDEX "list_event_id_idx" ON "list"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "list_item_carried_from_item_id_key" ON "list_item"("carried_from_item_id");

-- AddForeignKey
ALTER TABLE "list" ADD CONSTRAINT "list_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_item" ADD CONSTRAINT "list_item_carried_from_item_id_fkey" FOREIGN KEY ("carried_from_item_id") REFERENCES "list_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participant" ADD CONSTRAINT "event_participant_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participant" ADD CONSTRAINT "event_participant_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participant" ADD CONSTRAINT "event_participant_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_surprise_recipient" ADD CONSTRAINT "event_surprise_recipient_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_surprise_recipient" ADD CONSTRAINT "event_surprise_recipient_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Ajouts manuels (DAT-01) ---

-- EVT-05, EVT-09
ALTER TABLE "event" ADD CONSTRAINT "event_title_not_blank" CHECK (length(btrim("title")) > 0);
ALTER TABLE "event" ADD CONSTRAINT "event_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "event" ADD CONSTRAINT "event_budget_positive" CHECK ("suggested_budget_minor" IS NULL OR "suggested_budget_minor" > 0);
ALTER TABLE "event" ADD CONSTRAINT "event_surprise_is_honoree" CHECK (NOT "is_surprise" OR "mode" = 'HONOREE');
ALTER TABLE "event" ADD CONSTRAINT "event_cancelled_at_status" CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL));

-- EVT-29 : une liste personnelle n'est jamais rattachée à un événement.
ALTER TABLE "list" ADD CONSTRAINT "list_personal_no_event" CHECK ("personal_profile_id" IS NULL OR "event_id" IS NULL);

-- EVT-27 : une reprise ne désigne pas l'élément lui-même.
ALTER TABLE "list_item" ADD CONSTRAINT "list_item_carry_not_self" CHECK ("carried_from_item_id" IS NULL OR "carried_from_item_id" <> "id");

-- EVT-09 : forme et surprise fixées à la création.
CREATE FUNCTION "event_mode_immutable"() RETURNS trigger AS $$
BEGIN
  IF NEW."mode" <> OLD."mode" OR NEW."is_surprise" <> OLD."is_surprise" THEN
    RAISE EXCEPTION 'event mode and surprise are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "event_mode_immutable" BEFORE UPDATE ON "event"
  FOR EACH ROW EXECUTE FUNCTION "event_mode_immutable"();

-- EVT-07 (ADR 0017) : l'honoré d'une surprise n'est jamais participant de cet événement, et la
-- marque d'honoré d'un participant n'existe qu'en `HONOREE` sans surprise. Verrou exclusif sur la
-- ligne `event` (`FOR NO KEY UPDATE`, compatible avec les contrôles de clé étrangère) : deux
-- insertions concurrentes (participant et honoré secret) se sérialisent ; en lecture validée, la
-- requête suivante voit la ligne validée par l'autre.
CREATE FUNCTION "event_surprise_recipient_not_participant"() RETURNS trigger AS $$
DECLARE
  ev RECORD;
BEGIN
  SELECT "mode", "is_surprise" INTO ev FROM "event" WHERE "id" = NEW."event_id" FOR NO KEY UPDATE;
  IF TG_TABLE_NAME = 'event_participant' THEN
    IF NEW."is_honoree" AND (ev."mode" <> 'HONOREE' OR ev."is_surprise") THEN
      RAISE EXCEPTION 'honoree mark only on a non-surprise honoree event' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "event_surprise_recipient" WHERE "event_id" = NEW."event_id" AND "profile_id" = NEW."profile_id"
    ) THEN
      RAISE EXCEPTION 'surprise honoree cannot participate' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT ev."is_surprise" THEN
      RAISE EXCEPTION 'surprise recipient only on a surprise event' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "event_participant" WHERE "event_id" = NEW."event_id" AND "profile_id" = NEW."profile_id"
    ) THEN
      RAISE EXCEPTION 'participant cannot be a surprise honoree' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "event_participant_not_surprise_recipient" BEFORE INSERT OR UPDATE ON "event_participant"
  FOR EACH ROW EXECUTE FUNCTION "event_surprise_recipient_not_participant"();
CREATE TRIGGER "event_surprise_recipient_not_participant" BEFORE INSERT OR UPDATE ON "event_surprise_recipient"
  FOR EACH ROW EXECUTE FUNCTION "event_surprise_recipient_not_participant"();
