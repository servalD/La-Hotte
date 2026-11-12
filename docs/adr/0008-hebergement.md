# ADR 0008 — Hébergement sur VPS avec Docker Compose

**Statut :** accepté · 2026-11-11

## Contexte

Connexions longues (WebSocket), tâches de fond, service de récupération à isoler, données personnelles de familles à garder dans l'UE, budget modeste.

## Décision

Un VPS chez un hébergeur européen, Docker Compose, services décrits en DEP-02 : `caddy`, `web`, `api`, `worker`, `fetcher`, `postgres`, `redis`. Deux réseaux Docker : interne (tout sauf `fetcher`) et un réseau dédié à `fetcher`, relié à l'API par la seule file de tâches, avec sortie Internet filtrée.

- Caddy : TLS automatique, HTTP/2 et HTTP/3, en-têtes de sécurité, même origine pour web et API.
- Images construites en CI, déploiement par récupération d'image et bascule, retour arrière par l'image précédente.
- Sauvegardes chiffrées hors site (DEP-05).

## Raisons

- Coût fixe et faible, aucune limite de plateforme sur les WebSocket ni sur la durée des tâches.
- Maîtrise complète de la localisation des données.
- Tout est conteneurisé : migrer vers un orchestrateur ou des services gérés reste possible.

## Conséquences

- L'exploitation est à notre charge : mises à jour de l'hôte, surveillance, sauvegardes, restauration testée.
- Une seule machine : pas de haute disponibilité (objectif 99,5 %).
- PostgreSQL auto-hébergé : la sauvegarde continue et le test de restauration sont obligatoires avant l'ouverture.

## Ajout du 2026-11-12 : observabilité

L'ADR 0012 ajoute au Compose de production un collecteur OpenTelemetry, OpenObserve, GlitchTip (web et worker) et une base PostgreSQL dédiée, sur un réseau `obs` distinct. Conséquences pour cet ADR : le dimensionnement du VPS est à mesurer (OBS-40) et une sonde externe devient nécessaire (OBS-41), puisque la surveillance partage le sort du serveur.

## À trancher

- Hébergeur précis.
- Images : disque local sauvegardé ou stockage objet compatible S3 (préféré dès que le volume grandit).
- Passage à PostgreSQL géré si l'exploitation devient une charge.

## Alternatives écartées

Vercel + API hébergée ailleurs + base gérée (plusieurs fournisseurs à sécuriser, deux origines, coût variable) ; Kubernetes (disproportionné).
