-- CreateEnum
CREATE TYPE "example_priority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateTable
CREATE TABLE "example_item" (
    "id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "priority" "example_priority" NOT NULL DEFAULT 'NORMAL',
    "reserved_by_name" VARCHAR(80),
    "reserved_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "example_item_pkey" PRIMARY KEY ("id")
);

-- DAT-01 : invariants garantis en base (non exprimables dans le schéma Prisma).
ALTER TABLE "example_item"
    ADD CONSTRAINT "example_item_title_not_blank" CHECK (length(btrim("title")) > 0),
    ADD CONSTRAINT "example_item_version_positive" CHECK ("version" > 0),
    ADD CONSTRAINT "example_item_reservation_complete"
        CHECK (("reserved_by_name" IS NULL) = ("reserved_at" IS NULL));
