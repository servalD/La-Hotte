# ADR 0021 — Mise en œuvre de la phase 7 : administration, catalogue global, effacement, production

**Statut :** accepté · 2026-11-17

Précise l'ADR 0008 (hébergement) et l'ADR 0004 (visibilité) sans les remplacer.

## Contexte

La phase 7 donne aux exploitants des moyens d'agir sans leur donner celui de lire la vie privée des utilisateurs (ADM-01), ouvre le catalogue global à la modération (REP-04) et prépare la mise en production. Trois choix sont coûteux à défaire : où vit l'autorisation d'administration, comment l'audit reste vrai, et ce qu'on promet sur l'effacement d'une table en ajout seul.

## Décision

### Module `admin`

- Un module `admin` (`apps/api/src/modules/admin`) porte les cas d'usage d'administration. Il n'importe pas les dépôts des autres modules : il appelle leurs **ports** publics (`identity` pour suspendre, révoquer, attribuer un rôle ; `catalog` pour retirer une fiche ; `conversations` pour retirer un commentaire). La règle d'architecture `architecture/layers` le vérifie.
- Aucune route d'administration ne renvoie un contenu hors de ce qui est signalé (ADM-01, ADM-05, MOD-10) : les vues de réponse sont écrites pour l'espace d'administration et un test du schéma des réponses (OpenAPI) vérifie l'absence de tout champ de contenu.

### Autorisation (RBAC-04, RBAC-05)

- Un décorateur `@RequirePermission(Permission.X)` pose la permission requise ; un garde global, **refus par défaut**, relit le rôle en base à chaque requête `/admin` (pas de rôle dans le cache de session). La table RBAC-02 vit dans le domaine (`permissions.ts`), pas dans les contrôleurs.
- Le garde répond `404` à un compte sans la permission : l'espace n'existe pas pour lui (SEC-04). Un test parcourt toutes les routes enregistrées sous `/admin` avec `USER` et `MODERATOR` et compare au tableau RBAC-02 ; une route sans décorateur fait échouer ce test.
- CASL (RBAC-11) reste pour les politiques de ressource ; l'étage 1 est une simple table de permissions par rôle, plus lisible qu'une règle CASL sans condition.

### Audit transactionnel (AUD-05)

- Un port `AuditLog.append(entry, tx)` s'écrit dans la **même transaction Prisma** que l'action. Un cas d'usage d'administration reçoit l'unité de travail et ne peut pas écrire sans passer par elle. Une action sans écriture d'audit n'est pas compilable : le type de retour du cas d'usage exige le reçu `AuditReceipt`.
- Les effets hors base (e-mail, révocation du cache de session) partent **après** la validation (file d'effets de la transaction) ; si l'un échoue, une entrée « échec de la suite » est ajoutée.
- `audit_log` : `REVOKE UPDATE, DELETE` (DAT-02), pas de clé étrangère, aucun contenu (AUD-06). Une table d'audit n'est donc jamais « nettoyée » : à l'effacement d'un compte (RGPD-12), les lignes qui le citent restent (identifiant opaque), comme le journal de sécurité.

### Suspension et époque (ADM-06)

- La suspension incrémente `auth_epoch` (ADR 0014) dans la même transaction que le changement d'état, puis purge le cache de session. C'est l'époque qui coupe les sessions, parce que la branche « en cache » de la résolution de session ne revérifie pas `status`. Une connexion refusée par un compte suspendu répond comme un mauvais mot de passe (même délai).

### Catalogue global (MOD-05, MOD-06)

- `catalog_entry` porte l'URL normalisée et le compteur ; la fiche d'un utilisateur reste la sienne (REP-05 : « ajouter à ma liste » copie). La publication `GLOBAL` crée ou rejoint une entrée ; la dépublication décrémente. Le compteur compte des **comptes** distincts, pas des profils : trois profils d'une même famille ne font pas « trois personnes ».
- L'API du catalogue ne sérialise jamais `owner_profile_id`, ni la note, ni une photo de l'utilisateur : vue dédiée, sans ces membres (champs absents, pas vides).
- Le contrôle MOD-09 est un service de domaine pur (listes lues dans `platform_setting`), testé par propriétés (comparaison sans accent ni casse).

### Signalement (MOD-07, MOD-08)

- Le signalement vérifie la lisibilité de la cible **par le moteur** au nom du signaleur : le signalement ne devient pas un moyen de tester l'existence d'une ressource cachée (`404` identique).
- Le masquage à trois est un état dérivé (comptage de comptes distincts), lu à chaque lecture de la cible ; il ne modifie ni le fil ni sa `version`, pour ne rien apprendre à un destinataire (VIS-35).

### Export et effacement (RGPD-11, RGPD-12)

- L'export est lu **par les ports de lecture du moteur de visibilité** au nom du profil, jamais par une requête directe aux tables : c'est la seule façon de ne pas dupliquer les règles d'accès (invariant 2). Il s'écrit chiffré (SEC-22) dans `export_request` et s'efface au téléchargement.
- L'effacement s'exécute par une tâche nocturne dans le processus de l'API, par lots, avec reprise : chaque étape est idempotente. Les tables en ajout seul ne sont pas modifiées : une clé étrangère `ON DELETE SET NULL` vide la référence au profil (action référentielle, qui ne passe pas par les privilèges `UPDATE` du rôle applicatif). Une écriture de compta reste donc vraie, sans personne.

### Sécurité des lignes (DAT-05, reportée par l'ADR 0019)

- RLS en défense supplémentaire sur `comment`, `contribution`, `purchase`, `list_item`. La session de base porte `app.profile_id` posé par une transaction (`SET LOCAL`) ; une politique interdit à un destinataire la lecture des lignes d'offreurs. Le rôle propriétaire (migrations) n'est pas soumis aux politiques ; le rôle applicatif l'est. Essai préalable sur `comment` ; si le coût dans l'ORM se révèle disproportionné pour les trois autres, ce sera noté en reste, pas masqué.

### Production (ADR 0008)

- Hébergeur non choisi : `ops/production` ne dépend d'aucun fournisseur. Images dans un volume local sauvegardé, derrière un port `ImageStore` qui pourra viser un stockage S3 plus tard sans changer les modules.
- Inscriptions : `REGISTRATION_MODE=OPEN` au lancement (décision du 2026-11-17), réglable à chaud (ADM-09).

## Raisons

- Relire le rôle à chaque requête `/admin` évite qu'un rôle retiré survive dans un cache pendant 12 heures.
- L'audit dans la transaction rend « l'action a eu lieu sans trace » impossible par construction, ce que le critère d'acceptation de `11` exige.
- Une clé étrangère `SET NULL` est la seule façon d'anonymiser une table en ajout seul sans lui rendre `UPDATE`.
- Un compteur de comptes (pas de profils) évite de faire de la popularité d'une fiche un indice sur la composition d'un compte.

## Conséquences

- Le premier administrateur se crée par une commande d'exploitation (`pnpm --filter api admin:grant <email>`), jamais par l'interface (RBAC-03) ; elle exige le TOTP actif et écrit l'audit.
- Le dernier administrateur ne peut se retirer ni se supprimer ; sa perte de TOTP se traite par la même commande.
- La modération ne voit jamais l'auteur d'une fiche : pour notifier (MOD-11), le service d'envoi résout le compte à l'envoi, sans qu'une vue le renvoie.
- RLS ajoute une contrainte à chaque test d'intégration : la session de test doit poser `app.profile_id`.

## Alternatives écartées

- **Permissions dans le jeton de session** : survivent à un retrait de rôle.
- **Audit asynchrone par événement** : une action peut réussir sans trace si l'événement se perd.
- **Anonymiser par `UPDATE` avec un rôle privilégié** : rend la table en ajout seul modifiable en pratique.
- **Rôle `SUPPORT` distinct** : inutile tant que l'équipe est petite (`11`, Q1).
