# ADR 0006 — Temps réel par Socket.IO

**Statut :** accepté · 2026-11-11

## Contexte

Commentaires et notifications en direct, présence dans les fils, mise à jour des états de financement, et obligation de ne jamais diffuser un événement d'offreur à un destinataire.

## Décision

- **Socket.IO** par une passerelle NestJS, adaptateur Redis pour plusieurs instances.
- Authentification par le cookie de session à la poignée de main ; connexion liée au profil actif.
- **Salons** vérifiés à l'abonnement et à chaque changement de droits ; salons offreurs et public séparés.
- Le canal est **descendant** : le client n'écrit que par l'API REST (sauf présence et saisie).
- Émission après validation de la transaction, depuis les événements de domaine, à travers le moteur de visibilité.
- Rattrapage par numéro de séquence et route `/sync`.
- **Web Push** (VAPID) pour l'application fermée, par une tâche de fond.

## Raisons

- Salons, accusés de réception, reconnexion et repli de transport fournis ; intégration NestJS directe.
- Toutes les écritures gardent un seul chemin (validation, idempotence, autorisation).
- Le service est sur un VPS : aucune contrainte de plateforme sur les connexions longues.

## Conséquences

- Connexions à état : prévoir l'adaptateur Redis dès le départ.
- Les tests temps réel demandent deux clients simultanés (QA-13).

## Alternatives écartées

SSE (suffirait pour le descendant, mais pas de salons ni de présence, et limites de connexions par origine en HTTP/1.1) ; WebSocket brut (tout à réécrire) ; service hébergé (Pusher, Ably : données hors de notre contrôle).
