-- CreateEnum
CREATE TYPE "report_target_kind" AS ENUM ('PRODUCT', 'COMMENT');

-- CreateEnum
CREATE TYPE "report_reason" AS ENUM ('SPAM', 'INAPPROPRIATE', 'PRIVACY', 'ILLEGAL', 'OTHER');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('OPEN', 'DECIDED');

-- CreateEnum
CREATE TYPE "moderation_action" AS ENUM ('KEEP', 'REMOVE', 'REMOVE_AND_SUSPEND', 'CONTEST');

-- AlterEnum
ALTER TYPE "account_status" ADD VALUE 'PENDING_DELETION';

-- AlterTable
ALTER TABLE "account" ADD COLUMN     "deletion_requested_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_sign_in_at" TIMESTAMPTZ(3),
ADD COLUMN     "publication_suspended_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "report" (
    "id" UUID NOT NULL,
    "reporter_profile_id" UUID NOT NULL,
    "reporter_account_id" UUID NOT NULL,
    "target_kind" "report_target_kind" NOT NULL,
    "target_id" UUID NOT NULL,
    "reason" "report_reason" NOT NULL,
    "note" VARCHAR(500),
    "status" "report_status" NOT NULL DEFAULT 'OPEN',
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_decision" (
    "id" UUID NOT NULL,
    "target_kind" "report_target_kind" NOT NULL,
    "target_id" UUID NOT NULL,
    "action" "moderation_action" NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "actor_account_id" UUID NOT NULL,
    "parent_id" UUID,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_setting" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_account_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "export_request" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ready_at" TIMESTAMPTZ(3),
    "downloaded_at" TIMESTAMPTZ(3),
    "payload_enc" BYTEA,

    CONSTRAINT "export_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_account_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "target_kind" VARCHAR(32),
    "target_id" UUID,
    "reason" VARCHAR(500),
    "ip" INET,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_target_kind_target_id_status_idx" ON "report"("target_kind", "target_id", "status");

-- CreateIndex
CREATE INDEX "report_status_created_at_idx" ON "report"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "report_reporter_profile_id_target_kind_target_id_key" ON "report"("reporter_profile_id", "target_kind", "target_id");

-- CreateIndex
CREATE INDEX "moderation_decision_target_kind_target_id_at_idx" ON "moderation_decision"("target_kind", "target_id", "at");

-- CreateIndex
CREATE INDEX "moderation_decision_parent_id_idx" ON "moderation_decision"("parent_id");

-- CreateIndex
CREATE INDEX "export_request_profile_id_requested_at_idx" ON "export_request"("profile_id", "requested_at");

-- CreateIndex
CREATE INDEX "export_request_expires_at_idx" ON "export_request"("expires_at");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- CreateIndex
CREATE INDEX "audit_log_actor_account_id_at_idx" ON "audit_log"("actor_account_id", "at");

-- CreateIndex
CREATE INDEX "audit_log_target_id_at_idx" ON "audit_log"("target_id", "at");

-- CreateIndex
CREATE INDEX "account_deletion_requested_at_idx" ON "account"("deletion_requested_at");

-- CreateIndex
CREATE INDEX "account_last_sign_in_at_idx" ON "account"("last_sign_in_at");

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_profile_id_fkey" FOREIGN KEY ("reporter_profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decision" ADD CONSTRAINT "moderation_decision_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "moderation_decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_request" ADD CONSTRAINT "export_request_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RGPD-12 : `deletion_requested_at` présent si et seulement si l'effacement est demandé. La
-- comparaison passe par le texte : la valeur d'énumération ajoutée ci-dessus n'est pas encore
-- utilisable dans cette transaction.
ALTER TABLE "account" ADD CONSTRAINT "account_deletion_matches_status"
  CHECK (("deletion_requested_at" IS NOT NULL) = ("status"::text = 'PENDING_DELETION'));

-- MOD-07 : note bornée, sans texte vide.
ALTER TABLE "report" ADD CONSTRAINT "report_note_not_blank"
  CHECK ("note" IS NULL OR length(btrim("note")) > 0);

-- MOD-11 : une contestation a toujours pour parent la décision contestée.
ALTER TABLE "moderation_decision" ADD CONSTRAINT "moderation_decision_contest_has_parent"
  CHECK ("action" <> 'CONTEST' OR "parent_id" IS NOT NULL);

-- MOD-11 : une seule contestation par décision.
CREATE UNIQUE INDEX "moderation_decision_one_contest"
  ON "moderation_decision" ("parent_id") WHERE "action" = 'CONTEST';

-- DAT-02 : `audit_log` et `moderation_decision` sont en ajout seul.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wishlist_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_log" FROM wishlist_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "moderation_decision" FROM wishlist_app;
  END IF;
END
$$;

-- DAT-05, ADR 0021 : sécurité des lignes en défense supplémentaire. Le moteur de visibilité reste
-- la barrière principale. Une lecture faite au nom d'un profil pose `app.profile_id` pour sa
-- transaction (`SET LOCAL`) ; sans ce réglage, les politiques n'écartent rien (tâches de fond,
-- écritures). Le propriétaire des tables (migrations) n'y est pas soumis.

-- Profil au nom duquel la transaction lit, ou NULL.
CREATE FUNCTION "app_viewer"() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = public
AS $$
  SELECT NULLIF(current_setting('app.profile_id', true), '')::uuid
$$;

-- VIS-20, VIS-21 : le profil lecteur est destinataire de la liste de l'élément. `SECURITY DEFINER` :
-- la fonction lit `list_item` en propriétaire, sans la politique des suggestions, faute de quoi
-- le fil des offreurs d'une suggestion échapperait au contrôle.
CREATE FUNCTION "app_viewer_receives_item"(item uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT "app_viewer"() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM "list_item" li
    JOIN "list_recipient" lr ON lr."list_id" = li."list_id"
    WHERE li."id" = item AND lr."profile_id" = "app_viewer"()
  )
$$;

-- Même question pour une fiche de compta encore attachée à son élément. Une fiche détachée
-- (`item_id` vide) n'est jugée que par le moteur (CPT-68, CPT-73).
CREATE FUNCTION "app_viewer_receives_accounting"(accounting uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT "app_viewer"() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM "item_accounting" ia
    WHERE ia."id" = accounting AND ia."item_id" IS NOT NULL
      AND "app_viewer_receives_item"(ia."item_id")
  )
$$;

-- Fil des offreurs (COM-11) : jamais lu par un destinataire de la liste.
ALTER TABLE "comment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comment_access" ON "comment" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "comment_surprise" ON "comment" AS RESTRICTIVE FOR SELECT
  USING ("thread" <> 'GIVERS' OR NOT "app_viewer_receives_item"("item_id"));

-- Parts et achat (VIS-20) : jamais lus par un destinataire de la liste.
ALTER TABLE "contribution" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contribution_access" ON "contribution" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "contribution_surprise" ON "contribution" AS RESTRICTIVE FOR SELECT
  USING (NOT "app_viewer_receives_accounting"("accounting_id"));

ALTER TABLE "purchase" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "purchase_access" ON "purchase" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "purchase_surprise" ON "purchase" AS RESTRICTIVE FOR SELECT
  USING (NOT "app_viewer_receives_accounting"("accounting_id"));

-- Suggestions (WSH-04) : jamais lues par un destinataire de la liste.
ALTER TABLE "list_item" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "list_item_access" ON "list_item" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "list_item_surprise" ON "list_item" AS RESTRICTIVE FOR SELECT
  USING (NOT "is_suggestion" OR NOT EXISTS (
    SELECT 1 FROM "list_recipient" lr
    WHERE lr."list_id" = "list_item"."list_id" AND lr."profile_id" = "app_viewer"()
  ));
