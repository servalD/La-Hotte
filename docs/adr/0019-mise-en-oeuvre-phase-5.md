# ADR 0019 — Mise en œuvre de la phase 5 : compta des participations

**Statut :** accepté · 2026-11-17

## Contexte

La phase 5 ajoute la compta (`07`) : participations, acheteur, achat, écart de prix, règlements, soldes, budgets. Elle touche à trois invariants à la fois : la surprise (une donnée de compta ne doit atteindre aucun destinataire, ni par une réponse, ni par un refus, ni par une trame), l'argent (entiers, somme des parts égale au total) et l'ajout seul (un journal dont on peut tout reconstituer). Elle remplit aussi les ports d'engagements laissés vides depuis la phase 2 (VIS-16, EVT-26, EVT-30, EVT-31, EVT-34, notifications liées aux engagements).

Deux contraintes viennent des décisions de l'utilisateur : un changement de prix fait par le destinataire ne peut pas échouer (CPT-57), et une suppression ou une purge non plus (CPT-73). La compta doit donc survivre à l'élément sans jamais le retenir.

## Décision

### Fiche de compta détachable

- La compta d'un élément vit dans une table à part, `item_accounting`, créée à la première participation. Participations, achat, demandes et journal y sont rattachés, pas à `list_item`. `list_item` ne gagne aucune colonne : sa `version` ne bouge jamais pour une écriture de compta (VIS-35).
- `item_accounting.item_id` est `SET NULL`. Un déclencheur `BEFORE DELETE` sur `list_item` relève, dans la même instruction, le titre de la fiche et l'événement de la liste (`detached_title`, `detached_event_id`, `detached_at`). La suppression d'un élément et la purge d'une liste (en cascade) réussissent donc toujours, sans que le code de `lists` connaisse la compta.

### Module `accounting`

- **Domaine pur** : calcul des parts (fractions exactes, CPT-53 ; arrondi au centime inférieur et distribution des centimes par rang d'arrivée, CPT-07), écart (CPT-16, CPT-17), refus d'une hausse (CPT-18), soldes (CPT-67) et compensation (CPT-68). Toutes les sommes sont des entiers (`number` dans les bornes sûres, `bigint` en base) ; une borne haute de 10¹² unités mineures est vérifiée à l'entrée. Tests par propriétés (`fast-check`) : somme des parts égale au total quand l'élément est couvert, aucune part négative, résultat indépendant de l'ordre de lecture.
- **Écriture** : chaque cas d'usage ouvre une transaction, verrouille la fiche (`SELECT … FOR UPDATE` sur `item_accounting`), relit l'état, applique le domaine, écrit les lignes de projection (`contribution`, `purchase`…) et une écriture `ledger_entry` par ligne touchée (avant, après), puis valide. L'événement de domaine (`accounting.changed`) part après la validation (API-35, ADR 0018).
- **Journal** : `ledger_entry` est la source ; les tables de projection n'en sont que la forme courante, que la transaction tient à jour. Un test rejoue le journal de chaque scénario et compare avec la projection (CPT-70).
- **Idempotence** (CPT-71) : la ligne `idempotency_record` (profil, clé) est insérée **dans la transaction de l'opération**, avant tout effet ; un conflit d'unicité fait relire la ligne : même empreinte de requête, la réponse enregistrée est rendue ; autre empreinte, `409`. Deux requêtes simultanées avec la même clé se sérialisent sur l'index unique.

### Accès

- Le moteur de visibilité gagne les décisions de compta (`accountingAccess` : aucune, offreur, participant, acheteur) à partir de la forme de lecture de l'élément (déjà décidée par `itemAccess`) et du rôle du profil dans la fiche. Le module `accounting` ne réécrit aucune règle : il charge les faits par le lecteur d'accès de `lists` (`ItemAccessReader`, ADR 0018) et applique la décision.
- Un participant qui ne voit plus l'élément (VIS-37) ou dont l'élément est détaché (CPT-73) garde l'accès à sa part, à l'acheteur et à ses règlements, avec le seul titre : c'est sa participation qui ouvre l'accès, jamais l'élément.
- Les ports d'engagements de `lists` et `events` sont implémentés dans leurs propres couches d'infrastructure par une lecture seule des tables de compta. `accounting` dépend de `lists` (lecteur d'accès) ; l'inverse passerait par un cycle de modules.
- VIS-16 n'est appliqué que si l'auteur du changement n'est pas destinataire de la liste (VIS-37).

### Prix changé et revue

- La compta ne réagit pas à l'événement `item.changed` pour décider : à chaque écriture et à chaque lecture de la fiche, elle compare le coût de l'élément (prix × quantité, dans la devise de la compta) au coût prévu. Un écart sans demande en attente ouvre la demande (revue cochée, plus d'un participant) ou s'applique aussitôt. Ainsi aucune perte d'avis du bus ne peut laisser la compta en retard. L'événement ne sert qu'aux notifications et aux trames.

### Tâches planifiées

- Rappels de part (CPT-23, CPT-66) et reste non couvert (CPT-64) : tâches dans le processus, réclamation par `FOR UPDATE SKIP LOCKED` et colonnes « fait le » (`reminded_7_at`…), comme les rappels d'événements (ADR 0018). La fenêtre de refus d'une hausse n'a pas besoin de tâche : `raise_until` se compare à l'heure à chaque requête.

### Justificatif

- La photo passe par le même chemin que la photo d'une fiche (décodage et ré-encodage dans le service `fetcher`, EXT-46) et le même magasin, sous une clé aléatoire. Elle n'est **pas** servie par `GET /images/{key}` (ouvert à tout profil actif qui connaît la clé) mais par `GET /items/{id}/purchase/receipt`, qui exige la décision « participant » du moteur.

### RLS reportée

- DAT-05 (RLS sur `contribution` et `purchase`) est reportée à la phase 7. Elle exige de poser le profil actif dans chaque transaction de lecture (`SET LOCAL`), donc une transaction interactive par requête, dont la phase 4 a montré qu'elle saturait le pool en rafale. La barrière reste le moteur, doublée de dépôts dont chaque lecture exige la décision d'accès en paramètre, et des tests de non-fuite.

## Raisons

- Une fiche détachable est le seul moyen de garder la compta sans laisser une suppression échouer ni attendre : un `RESTRICT` ou un report trahirait la réservation.
- Le verrou par fiche sérialise exactement ce qui doit l'être (le reste d'un élément) sans bloquer le reste de la liste.
- Comparer le coût à chaque passage rend la compta juste même si un avis du bus se perd, sans boîte d'envoi transactionnelle.

## Conséquences

- Les lectures de compta coûtent une décision du moteur par élément ; le panier et les comptes chargent les faits par lots.
- Un élément détaché n'a plus de règle de visibilité : seuls ses participants le lisent, par leur participation.
- `pnpm test:leak` gagne un scénario de compta : montants, titres et noms absents de la télémétrie.

## Alternatives écartées

- **Colonnes de compta sur `list_item`** : simple, mais toute écriture d'offreur ferait bouger la version vue du destinataire, et la suppression emporterait la compta.
- **Suppression douce des éléments engagés** (retrait d'office) : le chemin de code de `lists` différerait selon l'engagement, et la purge de la corbeille aussi ; le déclencheur garde un seul chemin.
- **Compta dérivée seulement du journal, sans projection** : exact, mais chaque lecture rejouerait l'historique ; la projection tenue dans la même transaction donne le même résultat, et un test vérifie qu'elle reste égale au rejeu.
- **Revue déclenchée par l'événement `item.changed`** : un arrêt entre l'écriture et la livraison laisserait des parts sur un coût faux, sans trace.
