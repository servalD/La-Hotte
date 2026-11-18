-- MOD-11, DAT-02 (revue SEC-40 de la phase 7, I3) : une seule réponse à une contestation. Deux
-- modérateurs qui tranchent la même contestation à la fois ne peuvent écrire deux décisions
-- définitives contradictoires dans une table en ajout seul. Les décisions de premier niveau sont
-- protégées par un verrou de transaction sur la cible (`prisma-moderation-store.ts`).
CREATE UNIQUE INDEX "moderation_decision_one_ruling"
  ON "moderation_decision" ("parent_id")
  WHERE "parent_id" IS NOT NULL AND "action" <> 'CONTEST';
