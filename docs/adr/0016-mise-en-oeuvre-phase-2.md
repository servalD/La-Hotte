# ADR 0016 — Mise en œuvre du moteur de visibilité et de l'extraction

**Statut :** accepté · 2026-11-15 · précise l'ADR 0004 et l'ADR 0007

## Contexte

La phase 2 met en œuvre le moteur de visibilité (ADR 0004) et l'extraction (ADR 0007). Quatre points de ces ADR coûtent plus qu'ils ne rapportent à ce stade : CASL pour les permissions, la sécurité au niveau des lignes (RLS), une file BullMQ et un stockage objet des images.

## Décision

1. **Permissions sans CASL.** Les permissions d'action (LST-02, LST-03, VIS-18, WSH-07) sont des fonctions typées du domaine `visibility`, qui prennent les mêmes faits que les décisions de lecture. La matrice générée (VIS-33) les couvre aussi.
2. **RLS reportée.** DAT-05 reste prévue, et sera essayée avec la table `comment` en phase 4, comme le dit l'ADR 0004. En phase 2, la barrière est le moteur, doublée de critères de requête (VIS-31) et des tests de non-fuite.
3. **File d'extraction dans le processus.** Le port `ExtractionQueue` est servi par une file dans le processus de l'API. Un arrêt brutal perd l'extraction en cours ; le balayage de EXT-06 passe la fiche en `FAILED`, et le brouillon reste modifiable. BullMQ pourra prendre la place derrière le même port quand un `worker` séparé existera (tâche 7 de la phase 0 bis).
4. **Images sur disque.** Le port `ImageStore` est servi par un dossier local (`IMAGE_STORAGE_DIR`). Le choix entre disque et stockage objet reste à faire dans l'ADR 0008 ; changer d'adaptateur ne touche pas le domaine.
5. **Décodage dans le `fetcher`.** Toute image, téléchargée ou envoyée par l'utilisateur, est décodée et réencodée par le `fetcher` (EXT-46), qui sert aussi de bac à sable aux décodeurs.

## Raisons

- Une bibliothèque de permissions apporte une syntaxe, pas une garantie : la garantie vient de la matrice exhaustive, qui s'écrit aussi bien sur des fonctions pures.
- La RLS avec Prisma demande de poser une variable de session à chaque transaction ; mieux vaut l'essayer une fois, sur la table la plus sensible (`comment`), que de la poser à moitié.
- Une file persistante n'a d'intérêt qu'avec plusieurs processus ; l'échec d'une extraction est déjà un cas prévu (EXT-05).
- Les décodeurs d'images sont une source classique de failles ; les tenir hors de l'API isole la base.

## Conséquences

- `security-reviewer` relit les fonctions de permission comme le reste du moteur.
- L'API dépend du `fetcher` pour toute image : sans lui, l'ajout par photo échoue proprement (`503`), la saisie à la main reste possible.
- Le dossier d'images entre dans les sauvegardes (phase 7).

## Alternatives écartées

CASL tout de suite (dépendance de plus, sans test de plus) ; BullMQ dans l'API sans `worker` (Redis en plus sur le chemin, sans gain de robustesse tant qu'il n'y a qu'un processus) ; décodage dans l'API avec `sharp` (une faille de décodeur atteindrait le processus qui parle à la base).
