-- CreateEnum
CREATE TYPE "comment_thread" AS ENUM ('PUBLIC', 'GIVERS');

-- CreateEnum
CREATE TYPE "comment_kind" AS ENUM ('MESSAGE', 'ACTIVITY');

-- CreateEnum
CREATE TYPE "comment_reaction_kind" AS ENUM ('THUMBS_UP', 'HEART', 'LAUGH', 'WOW', 'PARTY', 'THANKS');

-- CreateEnum
CREATE TYPE "notification_category" AS ENUM ('INVITATIONS', 'LINKS', 'COMMENTS', 'MENTIONS', 'GIFTS', 'ITEMS', 'EVENTS', 'EXTRACTION', 'SECURITY');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('IN_APP', 'PUSH', 'EMAIL');

-- CreateEnum
CREATE TYPE "digest_frequency" AS ENUM ('DAILY', 'WEEKLY', 'OFF');

-- AlterTable
ALTER TABLE "event" ADD COLUMN     "day_after_at" TIMESTAMPTZ(3),
ADD COLUMN     "reminder_14_at" TIMESTAMPTZ(3),
ADD COLUMN     "reminder_3_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "comment" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "thread" "comment_thread" NOT NULL,
    "kind" "comment_kind" NOT NULL,
    "author_profile_id" UUID,
    "body" VARCHAR(2000) NOT NULL DEFAULT '',
    "mention_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "activity_code" VARCHAR(32),
    "activity_data" JSONB,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_reaction" (
    "comment_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "reaction" "comment_reaction_kind" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_reaction_pkey" PRIMARY KEY ("comment_id","profile_id","reaction")
);

-- CreateTable
CREATE TABLE "item_follow" (
    "item_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "following" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "item_follow_pkey" PRIMARY KEY ("item_id","profile_id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "seq" BIGINT NOT NULL,
    "category" "notification_category" NOT NULL,
    "type" VARCHAR(48) NOT NULL,
    "item_id" UUID,
    "thread" "comment_thread",
    "list_id" UUID,
    "event_id" UUID,
    "comment_id" UUID,
    "actor_profile_id" UUID,
    "data" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(3),
    "push_due_at" TIMESTAMPTZ(3),
    "push_sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_counter" (
    "profile_id" UUID NOT NULL,
    "last_seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "notification_counter_pkey" PRIMARY KEY ("profile_id")
);

-- CreateTable
CREATE TABLE "notification_pref" (
    "profile_id" UUID NOT NULL,
    "category" "notification_category" NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "notification_pref_pkey" PRIMARY KEY ("profile_id","category","channel")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "profile_id" UUID NOT NULL,
    "quiet_enabled" BOOLEAN NOT NULL DEFAULT true,
    "quiet_start" SMALLINT NOT NULL DEFAULT 1260,
    "quiet_end" SMALLINT NOT NULL DEFAULT 480,
    "digest" "digest_frequency" NOT NULL DEFAULT 'DAILY',
    "share_presence" BOOLEAN NOT NULL DEFAULT true,
    "last_digest_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("profile_id")
);

-- CreateTable
CREATE TABLE "push_subscription" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "endpoint" VARCHAR(1024) NOT NULL,
    "p256dh" VARCHAR(128) NOT NULL,
    "auth" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscription_profile" (
    "subscription_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "show_details" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscription_profile_pkey" PRIMARY KEY ("subscription_id","profile_id")
);

-- CreateIndex
CREATE INDEX "comment_item_id_thread_created_at_id_idx" ON "comment"("item_id", "thread", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "comment_author_profile_id_idx" ON "comment"("author_profile_id");

-- CreateIndex
CREATE INDEX "comment_reaction_profile_id_idx" ON "comment_reaction"("profile_id");

-- CreateIndex
CREATE INDEX "item_follow_profile_id_idx" ON "item_follow"("profile_id");

-- CreateIndex
CREATE INDEX "notification_profile_id_created_at_idx" ON "notification"("profile_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_push_due_at_idx" ON "notification"("push_due_at");

-- CreateIndex
CREATE INDEX "notification_created_at_idx" ON "notification"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_profile_id_seq_key" ON "notification"("profile_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscription_endpoint_key" ON "push_subscription"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscription_session_id_idx" ON "push_subscription"("session_id");

-- CreateIndex
CREATE INDEX "push_subscription_profile_profile_id_idx" ON "push_subscription_profile"("profile_id");

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "list_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_author_profile_id_fkey" FOREIGN KEY ("author_profile_id") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_follow" ADD CONSTRAINT "item_follow_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "list_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_follow" ADD CONSTRAINT "item_follow_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_profile_id_fkey" FOREIGN KEY ("actor_profile_id") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "list_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_counter" ADD CONSTRAINT "notification_counter_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_pref" ADD CONSTRAINT "notification_pref_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscription_profile" ADD CONSTRAINT "push_subscription_profile_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "push_subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscription_profile" ADD CONSTRAINT "push_subscription_profile_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DAT-01 : contraintes métier des échanges (COM-13 à COM-16, NOT-04, NOT-14, ADR 0018).
ALTER TABLE "comment" ALTER COLUMN "mention_ids" SET NOT NULL;
ALTER TABLE "comment" ADD CONSTRAINT "comment_activity_shape" CHECK (
  ("kind" = 'MESSAGE' AND "activity_code" IS NULL AND "activity_data" IS NULL)
  OR ("kind" = 'ACTIVITY' AND "activity_code" IS NOT NULL AND "body" = ''
      AND cardinality("mention_ids") = 0 AND "edited_at" IS NULL AND "deleted_at" IS NULL)
);
ALTER TABLE "comment" ADD CONSTRAINT "comment_deleted_is_empty" CHECK (
  "deleted_at" IS NULL OR ("body" = '' AND cardinality("mention_ids") = 0)
);
ALTER TABLE "comment" ADD CONSTRAINT "comment_message_not_blank" CHECK (
  "kind" <> 'MESSAGE' OR "deleted_at" IS NOT NULL OR length(btrim("body")) > 0
);
ALTER TABLE "comment" ADD CONSTRAINT "comment_mentions_max" CHECK (cardinality("mention_ids") <= 10);
ALTER TABLE "comment" ADD CONSTRAINT "comment_activity_code_format" CHECK (
  "activity_code" IS NULL OR "activity_code" ~ '^[A-Z][A-Z_]{1,31}$'
);

ALTER TABLE "notification" ADD CONSTRAINT "notification_seq_positive" CHECK ("seq" > 0);
ALTER TABLE "notification" ADD CONSTRAINT "notification_type_format" CHECK ("type" ~ '^[a-z][a-z_.]{1,47}$');
ALTER TABLE "notification" ADD CONSTRAINT "notification_thread_needs_item" CHECK ("thread" IS NULL OR "item_id" IS NOT NULL);
ALTER TABLE "notification_counter" ADD CONSTRAINT "notification_counter_non_negative" CHECK ("last_seq" >= 0);

-- NOT-04 : les notifications de sécurité ne se désactivent pas.
ALTER TABLE "notification_pref" ADD CONSTRAINT "notification_pref_security_on" CHECK ("category" <> 'SECURITY' OR "enabled");

-- NOT-14 : minutes depuis minuit.
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_quiet_range" CHECK (
  "quiet_start" BETWEEN 0 AND 1439 AND "quiet_end" BETWEEN 0 AND 1439
);

-- NOT-16 : un point de terminaison https ; la liste des hôtes permis est vérifiée par l'application.
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_endpoint_https" CHECK ("endpoint" ~ '^https://');