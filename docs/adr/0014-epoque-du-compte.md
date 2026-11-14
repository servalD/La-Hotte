# ADR 0014 — Époque du compte : double incrément et époque observée avant les identifiants

**Statut :** accepté · 2026-11-13

Précise l'ADR 0013, section « Génération d'authentification du compte », point « Ordre ». Le reste de l'ADR 0013 est inchangé.

## Contexte

L'ADR 0013 augmente l'époque du compte dans Redis (E → E+1), puis la transaction PostgreSQL écrit E+1 avec le changement (mot de passe, rôle, statut). La revue de sécurité de la tranche 1 de la phase 1 (2026-11-13) a relevé une fenêtre : une connexion qui vérifie le mot de passe **contre l'ancien hash**, encore en base entre l'augmentation dans Redis et la validation de la transaction, crée une session à l'époque E+1. Cette session reste valide après la transaction, qui écrit justement E+1. Un proche qui connaît l'ancien mot de passe et se reconnecte en boucle garde l'accès au changement de mot de passe.

Une autre fenêtre existe même avec un ordre corrigé : une connexion qui vérifie l'ancien hash avant la validation, puis lit l'époque après, recopie l'époque nouvelle.

## Décision

1. **Double incrément.** Un événement qui doit tout révoquer :
   1. porte l'époque de Redis à `max(Redis, PostgreSQL) + 1` (= E+1) : tout ce qui existe est refusé immédiatement, en échec fermé ;
   2. dans la transaction, écrit `auth_epoch = GREATEST(auth_epoch, E+2)` avec le changement : deux changements concurrents ne font jamais redescendre la base ;
   3. après la validation, porte Redis à E+2 (jamais en arrière).

   Une session créée dans la fenêtre porte au plus E+1 et est refusée après la validation. Si la transaction échoue, Redis vaut E+1 et la base E : l'époque courante reste `max(Redis, PostgreSQL)` = E+1 et la base est rattrapée vers l'avant (ADR 0013), l'utilisateur peut se reconnecter.

2. **Époque observée avant les identifiants.** Toute création de session (connexion, second facteur, retour OIDC) lit l'époque du compte **avant** de vérifier le moindre identifiant, et la transmet à la création de session. La création refuse si l'époque courante est différente. Une vérification faite contre un ancien secret porte donc l'époque d'avant le changement et échoue.

3. **Étape 3 perdue.** Si le processus s'arrête (ou si Redis ne répond pas) entre la validation et l'étape 3, Redis reste à E+1 et la base à E+2. Une session ouverte pendant la fenêtre, à E+1, est encore acceptée par le cache jusqu'à la confrontation suivante avec la base (5 minutes au plus, `persistActivity`), ou jusqu'à la prochaine lecture de l'état du compte, qui reporte E+2 dans Redis. Ce risque borné est accepté : la fenêtre suppose une connexion réussie avec l'ancien secret pendant les quelques centaines de millisecondes du changement, puis un arrêt du serveur à ce moment précis.

## Raisons

- Le double incrément sépare « tout ce qui a été créé avant ou pendant le changement » (≤ E+1) de « ce qui est créé après » (E+2), sans verrou partagé entre la connexion et le changement de mot de passe.
- Lire l'époque avant la vérification ferme la seconde fenêtre sans transaction autour du hachage argon2, qui est lent.

## Conséquences

- Port `SessionStore` : `beginEpochChange(accountId)` renvoie l'époque à écrire en base (E+2), `completeEpochChange(accountId, epoch)` porte Redis à cette valeur après la validation.
- `SessionLifecycle.create` exige l'époque observée (`observedEpoch`).
- Les époques augmentent de deux par événement. Elles restent des entiers sans signification hors comparaison d'égalité.

## Alternatives écartées

- **Vérifier le mot de passe sous le verrou de ligne du compte** : un hachage argon2 de plusieurs centaines de millisecondes dans une transaction, et une connexion bloque un changement de mot de passe.
- **Ne rien faire et compter sur la révocation ligne par ligne** : la session créée dans la fenêtre n'existait pas encore quand le nettoyage a lu les lignes.
