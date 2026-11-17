-- CreateEnum
CREATE TYPE "contribution_mode" AS ENUM ('FULL', 'PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "settlement_state" AS ENUM ('NONE', 'DUE', 'CLAIMED', 'SETTLED');

-- CreateEnum
CREATE TYPE "accounting_review_kind" AS ENUM ('COST', 'OPTIONS');

-- CreateEnum
CREATE TYPE "accounting_review_status" AS ENUM ('PENDING', 'APPROVED', 'REFUSED', 'REPLACED', 'CLOSED');

-- CreateEnum
CREATE TYPE "buyer_request_status" AS ENUM ('PENDING', 'ACCEPTED', 'REFUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "offset_proposal_status" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED', 'STALE');

-- CreateTable
CREATE TABLE "item_accounting" (
    "id" UUID NOT NULL,
    "item_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "planned_total_minor" BIGINT,
    "buyer_profile_id" UUID,
    "review_enabled" BOOLEAN NOT NULL DEFAULT true,
    "receipt_enabled" BOOLEAN NOT NULL DEFAULT false,
    "next_rank" INTEGER NOT NULL DEFAULT 1,
    "detached_title" VARCHAR(300),
    "detached_event_id" UUID,
    "detached_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "item_accounting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution" (
    "id" UUID NOT NULL,
    "accounting_id" UUID NOT NULL,
    "profile_id" UUID,
    "mode" "contribution_mode" NOT NULL,
    "share_num" INTEGER,
    "share_den" INTEGER,
    "units" INTEGER,
    "amount_minor" BIGINT,
    "pre_purchase_minor" BIGINT,
    "rank" INTEGER NOT NULL,
    "settled_minor" BIGINT NOT NULL DEFAULT 0,
    "settlement" "settlement_state" NOT NULL DEFAULT 'NONE',
    "settled_at" TIMESTAMPTZ(3),
    "settlement_note" VARCHAR(60),
    "reminded_7_at" TIMESTAMPTZ(3),
    "reminded_event_at" TIMESTAMPTZ(3),
    "nudged_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase" (
    "id" UUID NOT NULL,
    "accounting_id" UUID NOT NULL,
    "buyer_profile_id" UUID,
    "purchased_at" TIMESTAMPTZ(3) NOT NULL,
    "planned_total_minor" BIGINT,
    "actual_total_minor" BIGINT,
    "receipt_key" VARCHAR(64),
    "raise_until" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_review" (
    "id" UUID NOT NULL,
    "accounting_id" UUID NOT NULL,
    "kind" "accounting_review_kind" NOT NULL,
    "author_profile_id" UUID,
    "proposed" JSONB NOT NULL,
    "status" "accounting_review_status" NOT NULL DEFAULT 'PENDING',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_request" (
    "id" UUID NOT NULL,
    "accounting_id" UUID NOT NULL,
    "candidate_profile_id" UUID NOT NULL,
    "status" "buyer_request_status" NOT NULL DEFAULT 'PENDING',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shortfall_notice" (
    "id" UUID NOT NULL,
    "accounting_id" UUID NOT NULL,
    "author_profile_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "notified_profile_ids" UUID[],
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shortfall_notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offset_proposal" (
    "id" UUID NOT NULL,
    "proposer_profile_id" UUID NOT NULL,
    "counterpart_profile_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" "offset_proposal_status" NOT NULL DEFAULT 'PENDING',
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offset_proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" UUID NOT NULL,
    "accounting_id" UUID NOT NULL,
    "actor_profile_id" UUID,
    "kind" VARCHAR(40) NOT NULL,
    "target_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "operation_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "recipient_profile_id" UUID,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" SMALLINT NOT NULL,
    "response" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "item_accounting_item_id_key" ON "item_accounting"("item_id");

-- CreateIndex
CREATE INDEX "item_accounting_buyer_profile_id_idx" ON "item_accounting"("buyer_profile_id");

-- CreateIndex
CREATE INDEX "item_accounting_detached_event_id_idx" ON "item_accounting"("detached_event_id");

-- CreateIndex
CREATE INDEX "contribution_profile_id_settlement_idx" ON "contribution"("profile_id", "settlement");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_accounting_id_profile_id_key" ON "contribution"("accounting_id", "profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_accounting_id_rank_key" ON "contribution"("accounting_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_accounting_id_key" ON "purchase"("accounting_id");

-- CreateIndex
CREATE INDEX "purchase_buyer_profile_id_idx" ON "purchase"("buyer_profile_id");

-- CreateIndex
CREATE INDEX "accounting_review_accounting_id_idx" ON "accounting_review"("accounting_id");

-- CreateIndex
CREATE INDEX "buyer_request_accounting_id_idx" ON "buyer_request"("accounting_id");

-- CreateIndex
CREATE INDEX "shortfall_notice_accounting_id_idx" ON "shortfall_notice"("accounting_id");

-- CreateIndex
CREATE INDEX "offset_proposal_proposer_profile_id_idx" ON "offset_proposal"("proposer_profile_id");

-- CreateIndex
CREATE INDEX "offset_proposal_counterpart_profile_id_idx" ON "offset_proposal"("counterpart_profile_id");

-- CreateIndex
CREATE INDEX "ledger_entry_accounting_id_at_idx" ON "ledger_entry"("accounting_id", "at");

-- CreateIndex
CREATE INDEX "ledger_entry_operation_id_idx" ON "ledger_entry"("operation_id");

-- CreateIndex
CREATE INDEX "budget_profile_id_idx" ON "budget"("profile_id");

-- CreateIndex
CREATE INDEX "idempotency_record_expires_at_idx" ON "idempotency_record"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_record_profile_id_key_key" ON "idempotency_record"("profile_id", "key");

-- AddForeignKey
ALTER TABLE "item_accounting" ADD CONSTRAINT "item_accounting_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "list_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_accounting" ADD CONSTRAINT "item_accounting_buyer_profile_id_fkey" FOREIGN KEY ("buyer_profile_id") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution" ADD CONSTRAINT "contribution_accounting_id_fkey" FOREIGN KEY ("accounting_id") REFERENCES "item_accounting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution" ADD CONSTRAINT "contribution_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_accounting_id_fkey" FOREIGN KEY ("accounting_id") REFERENCES "item_accounting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_buyer_profile_id_fkey" FOREIGN KEY ("buyer_profile_id") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_review" ADD CONSTRAINT "accounting_review_accounting_id_fkey" FOREIGN KEY ("accounting_id") REFERENCES "item_accounting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_review" ADD CONSTRAINT "accounting_review_author_profile_id_fkey" FOREIGN KEY ("author_profile_id") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_review" ADD CONSTRAINT "accounting_review_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_request" ADD CONSTRAINT "buyer_request_accounting_id_fkey" FOREIGN KEY ("accounting_id") REFERENCES "item_accounting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_request" ADD CONSTRAINT "buyer_request_candidate_profile_id_fkey" FOREIGN KEY ("candidate_profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_request" ADD CONSTRAINT "buyer_request_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shortfall_notice" ADD CONSTRAINT "shortfall_notice_accounting_id_fkey" FOREIGN KEY ("accounting_id") REFERENCES "item_accounting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shortfall_notice" ADD CONSTRAINT "shortfall_notice_author_profile_id_fkey" FOREIGN KEY ("author_profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offset_proposal" ADD CONSTRAINT "offset_proposal_proposer_profile_id_fkey" FOREIGN KEY ("proposer_profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offset_proposal" ADD CONSTRAINT "offset_proposal_counterpart_profile_id_fkey" FOREIGN KEY ("counterpart_profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_accounting_id_fkey" FOREIGN KEY ("accounting_id") REFERENCES "item_accounting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_recipient_profile_id_fkey" FOREIGN KEY ("recipient_profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Contraintes écrites à la main (DAT-01)
-- ---------------------------------------------------------------------------

-- Montants en unités mineures, jamais négatifs (invariant 4).
ALTER TABLE "item_accounting"
  ADD CONSTRAINT "item_accounting_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "item_accounting_planned_check" CHECK ("planned_total_minor" IS NULL OR "planned_total_minor" >= 0),
  ADD CONSTRAINT "item_accounting_rank_check" CHECK ("next_rank" >= 1),
  -- CPT-73 : détachée si et seulement si l'élément a disparu.
  ADD CONSTRAINT "item_accounting_detached_check" CHECK (("item_id" IS NULL) = ("detached_at" IS NOT NULL));

ALTER TABLE "contribution"
  -- CPT-53 : fraction exacte présente si et seulement si pourcentage, 0 < num ≤ den ≤ 10000.
  ADD CONSTRAINT "contribution_share_check" CHECK (
    ("mode" = 'PERCENT') = ("share_num" IS NOT NULL AND "share_den" IS NOT NULL)
    AND ("share_num" IS NULL OR ("share_num" > 0 AND "share_den" > 0 AND "share_num" <= "share_den" AND "share_den" <= 10000))
  ),
  -- CPT-55 : montant inconnu seulement en `FULL`.
  ADD CONSTRAINT "contribution_amount_check" CHECK (
    ("amount_minor" IS NOT NULL OR "mode" = 'FULL')
    AND ("amount_minor" IS NULL OR "amount_minor" >= 0)
    AND ("pre_purchase_minor" IS NULL OR "pre_purchase_minor" >= 0)
    AND "settled_minor" >= 0
  ),
  ADD CONSTRAINT "contribution_units_check" CHECK ("units" IS NULL OR ("units" >= 1 AND "mode" = 'FIXED')),
  ADD CONSTRAINT "contribution_rank_check" CHECK ("rank" >= 1);

ALTER TABLE "purchase"
  ADD CONSTRAINT "purchase_amounts_check" CHECK (
    ("planned_total_minor" IS NULL OR "planned_total_minor" >= 0)
    AND ("actual_total_minor" IS NULL OR "actual_total_minor" >= 0)
  );

ALTER TABLE "shortfall_notice"
  ADD CONSTRAINT "shortfall_notice_amount_check" CHECK ("amount_minor" > 0);

ALTER TABLE "offset_proposal"
  ADD CONSTRAINT "offset_proposal_pair_check" CHECK ("proposer_profile_id" <> "counterpart_profile_id"),
  ADD CONSTRAINT "offset_proposal_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

-- CPT-69 : budget strictement positif ; un par événement, et un par destinataire au plus.
ALTER TABLE "budget"
  ADD CONSTRAINT "budget_amount_check" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "budget_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "budget_scope_key" UNIQUE NULLS NOT DISTINCT ("profile_id", "event_id", "recipient_profile_id");

-- CPT-58, CPT-61, CPT-68 : une seule demande en attente.
CREATE UNIQUE INDEX "accounting_review_pending_key" ON "accounting_review"("accounting_id", "kind") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "buyer_request_pending_key" ON "buyer_request"("accounting_id") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "offset_proposal_pending_key" ON "offset_proposal"(
  LEAST("proposer_profile_id", "counterpart_profile_id"),
  GREATEST("proposer_profile_id", "counterpart_profile_id"),
  "currency"
) WHERE "status" = 'PENDING';

-- ---------------------------------------------------------------------------
-- CPT-73, ADR 0019 : la compta survit à l'élément, sans jamais retenir sa suppression.
-- ---------------------------------------------------------------------------

-- Une liste supprimée emporte ses éléments en cascade ; quand leur déclencheur s'exécute, la
-- liste n'est plus lisible. L'événement est donc relevé ici d'abord.
CREATE FUNCTION "list_accounting_event"() RETURNS trigger AS $$
BEGIN
  IF OLD."event_id" IS NOT NULL THEN
    UPDATE "item_accounting" a SET "detached_event_id" = OLD."event_id"
      FROM "list_item" i
     WHERE i."list_id" = OLD."id" AND a."item_id" = i."id";
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "list_accounting_event" BEFORE DELETE ON "list"
  FOR EACH ROW EXECUTE FUNCTION "list_accounting_event"();

CREATE FUNCTION "item_accounting_detach"() RETURNS trigger AS $$
BEGIN
  UPDATE "item_accounting" a
     SET "item_id" = NULL,
         "detached_title" = (SELECT left(p."title", 300) FROM "product" p WHERE p."id" = OLD."product_id"),
         "detached_event_id" = COALESCE(
           (SELECT l."event_id" FROM "list" l WHERE l."id" = OLD."list_id"),
           a."detached_event_id"
         ),
         "detached_at" = now(),
         "updated_at" = now(),
         "version" = a."version" + 1
   WHERE a."item_id" = OLD."id";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "item_accounting_detach" BEFORE DELETE ON "list_item"
  FOR EACH ROW EXECUTE FUNCTION "item_accounting_detach"();

-- DAT-02 : journal en ajout seul.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wishlist_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "ledger_entry" FROM wishlist_app;
  END IF;
END
$$;
