-- AlterTable
ALTER TABLE "comment" ADD COLUMN     "masked_at" TIMESTAMPTZ(3),
ADD COLUMN     "moderated_at" TIMESTAMPTZ(3);


-- MOD-10 : un message retiré par la modération n'est plus masqué : il est retiré.
ALTER TABLE "comment" ADD CONSTRAINT "comment_moderation_state" CHECK ("moderated_at" IS NULL OR "masked_at" IS NULL);
