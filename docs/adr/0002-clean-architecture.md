# ADR 0002 — Architecture propre par module métier

**Statut :** accepté · 2026-11-11

## Contexte

Les règles du produit (visibilité, surprise, compta) sont nombreuses, critiques et doivent pouvoir être testées sans base de données ni serveur web.

## Décision

Dans `apps/api`, un dossier par module métier, quatre couches : `domain`, `application`, `infrastructure`, `presentation`. Les dépendances pointent vers l'intérieur. Le domaine définit des ports ; l'infrastructure les implémente ; NestJS assure l'injection.

- Un cas d'usage = une classe = un fichier, avec une méthode `execute`.
- Les entités du domaine ne sont pas les modèles Prisma : un mappeur par dépôt.
- Les modules se parlent par leur interface publique (`index.ts`) ou par événements de domaine, jamais par import interne.
- Règle de lint bloquante sur le sens des imports (QA-03).

## Raisons

- Le moteur de visibilité et la compta se testent en mémoire, exhaustivement et vite.
- Changer d'ORM, de fournisseur de modèle ou de transport temps réel ne touche pas les règles.
- Un cadre répétitif et explicite convient bien à une implémentation assistée par IA : chaque tâche a un emplacement évident.

## Conséquences

- Plus de fichiers et de mappeurs qu'un CRUD NestJS classique. Accepté pour les modules à règles ; un module purement technique peut rester plat s'il n'a pas de domaine.
- Discipline à tenir : pas de logique dans les contrôleurs ni dans les dépôts.

## Alternatives écartées

Services NestJS adossés directement à Prisma (rapide au début, règles éparpillées et intestables) ; CQRS et event sourcing complets (disproportionnés ; seul le journal de compta est en ajout seul).
