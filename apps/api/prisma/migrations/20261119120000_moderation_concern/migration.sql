-- ADM-05, AUD-06 (revue SEC-40 des restes de la phase 7, I2) : qui une cible concernait au moment
-- d'une décision de modération (auteur, règles et destinataires des éléments qui la référencent).
-- Écrit avec la décision, jamais modifié (table en ajout seul, DAT-02), jamais rendu par l'API :
-- il sert à soustraire au lecteur du journal d'audit les entrées qui le concernaient, même après la
-- disparition de la cible ou un changement de règle. Nul pour les décisions antérieures.
ALTER TABLE "moderation_decision" ADD COLUMN "concern" JSONB;
