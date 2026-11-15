-- PIN-03 (revue SEC-40 de la tranche 5, C2-M1) : PIN faux saisis depuis la dernière entrée dans le
-- profil. Contrairement à `pin_failed_count`, ni un PIN juste ni un changement de PIN ne l'effacent :
-- seule l'entrée dans le profil, qui le montre à son titulaire.
ALTER TABLE "profile" ADD COLUMN "pin_failures_since_entry" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "profile"
    ADD CONSTRAINT "profile_pin_failures_since_entry_non_negative"
    CHECK ("pin_failures_since_entry" >= 0);
