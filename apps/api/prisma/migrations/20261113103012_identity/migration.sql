-- CreateEnum
CREATE TYPE "account_role" AS ENUM ('USER', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "auth_provider" AS ENUM ('GOOGLE');

-- CreateEnum
CREATE TYPE "account_token_purpose" AS ENUM ('EMAIL_VERIFY', 'EMAIL_CHANGE', 'EMAIL_CHANGE_CANCEL', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "pin_relock" AS ENUM ('NEVER', 'IDLE_15', 'EVERY_OPEN');

-- CreateTable
CREATE TABLE "account" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "email_verified_at" TIMESTAMPTZ(3),
    "password_hash" VARCHAR(255),
    "role" "account_role" NOT NULL DEFAULT 'USER',
    "status" "account_status" NOT NULL DEFAULT 'ACTIVE',
    "totp_secret_enc" BYTEA,
    "totp_enabled_at" TIMESTAMPTZ(3),
    "age_attested_at" TIMESTAMPTZ(3) NOT NULL,
    "auth_epoch" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identity" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "provider" "auth_provider" NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_code" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "code_hash" VARCHAR(255) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recovery_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_token" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "purpose" "account_token_purpose" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "new_email" VARCHAR(254),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "account_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "auth_epoch" INTEGER NOT NULL,
    "active_profile_id" UUID,
    "reauth_at" TIMESTAMPTZ(3),
    "trusted_device_id" UUID,
    "user_agent" VARCHAR(512) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trusted_device" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "user_agent" VARCHAR(512) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trusted_device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "display_name" VARCHAR(60) NOT NULL,
    "avatar" VARCHAR(200),
    "accent_color" CHAR(7) NOT NULL,
    "birthday_day" SMALLINT,
    "birthday_month" SMALLINT,
    "birthday_year" SMALLINT,
    "locale" VARCHAR(16) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "is_child" BOOLEAN NOT NULL DEFAULT false,
    "pin_hash" VARCHAR(255),
    "pin_relock" "pin_relock" NOT NULL DEFAULT 'IDLE_15',
    "pin_failed_count" INTEGER NOT NULL DEFAULT 0,
    "pin_locked_until" TIMESTAMPTZ(3),
    "pin_reset_notice_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_log" (
    "id" UUID NOT NULL,
    "account_id" UUID,
    "event" VARCHAR(64) NOT NULL,
    "ip" INET NOT NULL,
    "user_agent" VARCHAR(512) NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_email_key" ON "account"("email");

-- CreateIndex
CREATE INDEX "auth_identity_account_id_idx" ON "auth_identity"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identity_provider_subject_key" ON "auth_identity"("provider", "subject");

-- CreateIndex
CREATE INDEX "recovery_code_account_id_idx" ON "recovery_code"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_token_token_hash_key" ON "account_token"("token_hash");

-- CreateIndex
CREATE INDEX "account_token_account_id_purpose_idx" ON "account_token"("account_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_hash_key" ON "session"("token_hash");

-- CreateIndex
CREATE INDEX "session_account_id_idx" ON "session"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "trusted_device_token_hash_key" ON "trusted_device"("token_hash");

-- CreateIndex
CREATE INDEX "trusted_device_account_id_idx" ON "trusted_device"("account_id");

-- CreateIndex
CREATE INDEX "profile_account_id_idx" ON "profile"("account_id");

-- CreateIndex
CREATE INDEX "security_log_account_id_at_idx" ON "security_log"("account_id", "at");

-- AddForeignKey
ALTER TABLE "auth_identity" ADD CONSTRAINT "auth_identity_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_token" ADD CONSTRAINT "account_token_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_active_profile_id_fkey" FOREIGN KEY ("active_profile_id") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_trusted_device_id_fkey" FOREIGN KEY ("trusted_device_id") REFERENCES "trusted_device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_device" ADD CONSTRAINT "trusted_device_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile" ADD CONSTRAINT "profile_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DAT-01 : invariants garantis en base (non exprimables dans le schéma Prisma).
ALTER TABLE "account"
    -- E-mail normalisé par l'application : l'index unique est donc insensible à la casse.
    ADD CONSTRAINT "account_email_normalized" CHECK ("email" = lower(btrim("email")) AND "email" LIKE '%_@_%'),
    ADD CONSTRAINT "account_auth_epoch_non_negative" CHECK ("auth_epoch" >= 0),
    ADD CONSTRAINT "account_totp_has_secret" CHECK ("totp_enabled_at" IS NULL OR "totp_secret_enc" IS NOT NULL);

ALTER TABLE "account_token"
    ADD CONSTRAINT "account_token_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "account_token_new_email" CHECK (
        CASE "purpose"
            WHEN 'EMAIL_CHANGE' THEN "new_email" IS NOT NULL
            WHEN 'EMAIL_CHANGE_CANCEL' THEN TRUE
            ELSE "new_email" IS NULL
        END),
    ADD CONSTRAINT "account_token_new_email_normalized" CHECK ("new_email" IS NULL OR "new_email" = lower(btrim("new_email"))),
    ADD CONSTRAINT "account_token_expiry_after_creation" CHECK ("expires_at" > "created_at");

ALTER TABLE "session"
    ADD CONSTRAINT "session_token_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "session_auth_epoch_non_negative" CHECK ("auth_epoch" >= 0),
    ADD CONSTRAINT "session_expiry_within_absolute" CHECK ("expires_at" <= "absolute_expires_at"),
    ADD CONSTRAINT "session_absolute_after_creation" CHECK ("absolute_expires_at" > "created_at");

ALTER TABLE "trusted_device"
    ADD CONSTRAINT "trusted_device_token_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "trusted_device_expiry_after_creation" CHECK ("expires_at" > "created_at");

ALTER TABLE "profile"
    ADD CONSTRAINT "profile_display_name_not_blank" CHECK (length(btrim("display_name")) > 0),
    ADD CONSTRAINT "profile_accent_color_format" CHECK ("accent_color" ~ '^#[0-9a-f]{6}$'),
    ADD CONSTRAINT "profile_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "profile_birthday_day" CHECK ("birthday_day" IS NULL OR "birthday_day" BETWEEN 1 AND 31),
    ADD CONSTRAINT "profile_birthday_month" CHECK ("birthday_month" IS NULL OR "birthday_month" BETWEEN 1 AND 12),
    ADD CONSTRAINT "profile_birthday_year" CHECK ("birthday_year" IS NULL OR "birthday_year" BETWEEN 1900 AND 2200),
    -- Jour et mois vont ensemble ; l'année est facultative mais suppose le jour et le mois (PRO-02).
    ADD CONSTRAINT "profile_birthday_complete" CHECK (
        ("birthday_day" IS NULL) = ("birthday_month" IS NULL)
        AND ("birthday_year" IS NULL OR "birthday_day" IS NOT NULL)),
    ADD CONSTRAINT "profile_pin_failed_count_non_negative" CHECK ("pin_failed_count" >= 0),
    ADD CONSTRAINT "profile_version_positive" CHECK ("version" > 0);

ALTER TABLE "security_log"
    ADD CONSTRAINT "security_log_event_format" CHECK ("event" ~ '^[a-z]+(\.[a-z_]+)+$');

-- PRO-01 : 10 profils au plus par compte. Le verrou sur la ligne du compte sérialise les
-- créations concurrentes d'un même compte.
CREATE FUNCTION "profile_limit_per_account"() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM "account" WHERE "id" = NEW."account_id" FOR UPDATE;
    IF (SELECT count(*) FROM "profile" WHERE "account_id" = NEW."account_id") >= 10 THEN
        RAISE EXCEPTION 'profile limit reached' USING ERRCODE = 'check_violation',
            CONSTRAINT = 'profile_limit_per_account';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER "profile_limit_per_account"
    BEFORE INSERT OR UPDATE OF "account_id" ON "profile"
    FOR EACH ROW EXECUTE FUNCTION "profile_limit_per_account"();

-- SEC-03 : le profil actif d'une session appartient au compte de la session. Déclencheur plutôt
-- qu'une clé étrangère composite, que le schéma Prisma ne sait pas décrire.
CREATE FUNCTION "session_active_profile_same_account"() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."active_profile_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "profile"
        WHERE "id" = NEW."active_profile_id" AND "account_id" = NEW."account_id"
    ) THEN
        RAISE EXCEPTION 'active profile of another account' USING ERRCODE = 'check_violation',
            CONSTRAINT = 'session_active_profile_same_account';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER "session_active_profile_same_account"
    BEFORE INSERT OR UPDATE OF "active_profile_id", "account_id" ON "session"
    FOR EACH ROW EXECUTE FUNCTION "session_active_profile_same_account"();

-- Même règle vue du profil : un profil actif dans une session ne change pas de compte.
CREATE FUNCTION "profile_account_matches_sessions"() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "session"
        WHERE "active_profile_id" = NEW."id" AND "account_id" <> NEW."account_id"
    ) THEN
        RAISE EXCEPTION 'profile active in a session of another account'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'profile_account_matches_sessions';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER "profile_account_matches_sessions"
    BEFORE UPDATE OF "account_id" ON "profile"
    FOR EACH ROW EXECUTE FUNCTION "profile_account_matches_sessions"();

-- DAT-02 : `security_log` est en ajout seul. Les privilèges par défaut accordent UPDATE et
-- DELETE au rôle applicatif sur toute nouvelle table : on les retire ici. Le rôle n'existe pas
-- dans tous les environnements (base fantôme).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wishlist_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "security_log" FROM wishlist_app;
  END IF;
END
$$;
