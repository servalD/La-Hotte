-- Revue SEC-40 de la phase 5, cycle 1.

-- I2 (CPT-52, CPT-73) : destinataires de la liste et honorés d'une surprise, relevés au détachement.
-- Ils n'obtiennent jamais rien d'une fiche détachée, même engagés.
ALTER TABLE "item_accounting" ADD COLUMN "detached_recipient_ids" UUID[] NOT NULL DEFAULT '{}';

-- Profils exclus d'une liste : ses destinataires, et les honorés de la surprise à laquelle elle est rattachée.
CREATE FUNCTION "list_excluded_profiles"(list_id UUID, event_id UUID) RETURNS UUID[] AS $$
  SELECT COALESCE(array_agg(DISTINCT p), '{}') FROM (
    SELECT r."profile_id" AS p FROM "list_recipient" r WHERE r."list_id" = $1
    UNION
    SELECT s."profile_id" FROM "event_surprise_recipient" s WHERE $2 IS NOT NULL AND s."event_id" = $2
  ) x;
$$ LANGUAGE sql STABLE;

-- I1 : un seul ordre de verrous partout, `list_item` puis `item_accounting`.
CREATE OR REPLACE FUNCTION "list_accounting_event"() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM "list_item" WHERE "list_id" = OLD."id" ORDER BY "id" FOR UPDATE;
  UPDATE "item_accounting" a
     SET "detached_event_id" = COALESCE(OLD."event_id", a."detached_event_id"),
         "detached_recipient_ids" = "list_excluded_profiles"(OLD."id", OLD."event_id")
    FROM "list_item" i
   WHERE i."list_id" = OLD."id" AND a."item_id" = i."id";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "item_accounting_detach"() RETURNS trigger AS $$
DECLARE
  list_event UUID;
  list_found BOOLEAN;
BEGIN
  SELECT l."event_id", TRUE INTO list_event, list_found FROM "list" l WHERE l."id" = OLD."list_id";
  UPDATE "item_accounting" a
     SET "item_id" = NULL,
         "detached_title" = (SELECT left(p."title", 300) FROM "product" p WHERE p."id" = OLD."product_id"),
         "detached_event_id" = COALESCE(list_event, a."detached_event_id"),
         "detached_recipient_ids" = CASE
           WHEN list_found THEN "list_excluded_profiles"(OLD."list_id", list_event)
           ELSE a."detached_recipient_ids"
         END,
         "detached_at" = now(),
         "updated_at" = now(),
         "version" = a."version" + 1
   WHERE a."item_id" = OLD."id";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
