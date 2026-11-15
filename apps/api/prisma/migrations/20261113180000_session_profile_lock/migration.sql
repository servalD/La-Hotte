-- SEC-03, revue SEC-40 de la tranche 1 (point mineur 2) : le déclencheur de session lit le profil
-- sous verrou partagé. Un déplacement concurrent du profil vers un autre compte (déclencheur
-- `profile_account_matches_sessions`, qui prend un verrou exclusif par son UPDATE) attend donc la
-- fin de la transaction de session, et inversement : les deux contrôles ne peuvent plus se croiser.
CREATE OR REPLACE FUNCTION "session_active_profile_same_account"() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    profile_account UUID;
BEGIN
    IF NEW."active_profile_id" IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT "account_id" INTO profile_account FROM "profile"
    WHERE "id" = NEW."active_profile_id"
    FOR SHARE;
    IF profile_account IS DISTINCT FROM NEW."account_id" THEN
        RAISE EXCEPTION 'active profile of another account' USING ERRCODE = 'check_violation',
            CONSTRAINT = 'session_active_profile_same_account';
    END IF;
    RETURN NEW;
END
$$;
