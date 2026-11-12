# ADR 0004 — Moteur de visibilité centralisé

**Statut :** accepté · 2026-11-11

## Contexte

Le risque propre au produit est de révéler une surprise. Les règles (audience de liste, règle d'élément, règle de surprise, giftlist cachée) se combinent, et la même donnée sort par plusieurs canaux : API, temps réel, notifications, recherche, export, cache hors ligne.

## Décision

Un module de domaine `visibility` est le **seul** endroit qui décide de ce qu'un profil voit.

1. **Décision** : `canSee(profil, ressource)` et `viewOf(profil, élément)` renvoient un type de vue distinct selon le demandeur (`RecipientView`, `GiverView`). Les champs d'offreur n'existent pas dans le type de la vue destinataire.
2. **Filtrage en base** : le module fournit aux dépôts des critères de requête ; on ne charge pas pour filtrer ensuite.
3. **Canaux** : API, émission temps réel, notifications, recherche et export appellent tous le module. Aucun ne reconstruit une règle.
4. **Permissions d'action** : écrites avec CASL à partir des mêmes faits (rôles de liste, d'événement, destinataire ou non).
5. **Défenses supplémentaires** : salons temps réel séparés offreurs / public ; dépôts distincts pour les deux fils de commentaires ; RLS PostgreSQL sur les tables d'offreurs, à confirmer après essai sur `comment`.
6. **Preuve** : matrice de tests générée couvrant toutes les combinaisons, plus tests de non-fuite par route et par salon, bloquants en CI.

## Raisons

- Une règle écrite une fois se teste une fois, exhaustivement.
- Le typage rend la fuite difficile à écrire par inadvertance.
- Plusieurs barrières indépendantes : une erreur dans l'une ne suffit pas.

## Conséquences

- Tout module de lecture dépend de `visibility` : c'est un point de couplage assumé.
- Les réponses dépendent du demandeur : pas de cache HTTP partagé sur ces routes.
- Toute modification du module exige Opus 5.5 et la revue `security-reviewer`.

## Alternatives écartées

Vérifications dans chaque contrôleur (oubli inévitable) ; filtrage côté client (les données seraient déjà parties) ; RLS seule (difficile à tester et à faire évoluer, insuffisante pour les agrégats et le temps réel).
