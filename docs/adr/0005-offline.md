# ADR 0005 — Hors ligne : cache et file d'attente, serveur arbitre

**Statut :** accepté · 2026-11-11

## Contexte

L'application doit s'ouvrir et servir sans réseau (en magasin notamment). Mais les droits de lecture sont fins et changeants, et la compta ne tolère pas deux vérités.

## Décision

- Service worker **Serwist** : pré-cache de l'enveloppe applicative, stratégie réseau pour l'API (pas de cache d'API dans le service worker).
- Données : **TanStack Query** avec persistance en **IndexedDB**, une base par profil, chiffrée pour les profils à PIN (clé délivrée par le serveur après validation du PIN, gardée en mémoire).
- Écritures : **file de mutations** persistante, chaque entrée avec clé d'idempotence, profil et version de la ressource ; rejouée dans l'ordre à la reconnexion.
- Le serveur accepte, refuse ou signale un conflit ; le client affiche l'état « en attente » jusqu'à la réponse.
- Certaines actions exigent le réseau (règles de visibilité, invitations, sécurité).
- Purge du cache à la déconnexion et sur l'événement `access.revoked`.

## Raisons

- Le serveur reste la seule source de vérité : pas de fusion automatique à raisonner ni à sécuriser.
- Le cache ne contient que des vues déjà filtrées par le moteur de visibilité.
- Mêmes bibliothèques que pour l'accès aux données en ligne : peu de mécanique supplémentaire.

## Conséquences

- Hors ligne, on ne voit que ce qui a été chargé ou préchargé (OFF-03).
- Les conflits de modification sont montrés à l'utilisateur plutôt que résolus seuls.
- La synchronisation en arrière-plan n'existe pas sur tous les navigateurs : la file est rejouée à l'ouverture.

## Alternatives écartées

Base locale répliquée (PowerSync, ElectricSQL, RxDB) et CRDT : expérience très fluide, mais il faudrait exprimer les règles de visibilité une seconde fois dans les règles de réplication, avec un risque de fuite directement dans la base locale de l'appareil. Hors ligne en lecture seule : insuffisant pour cocher un achat en magasin.
