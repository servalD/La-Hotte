# ADR 0020 — Mise en œuvre de la phase 6 : cache cloisonné, file d'actions, enveloppe hors ligne

**Statut :** accepté · 2026-11-17

Précise l'ADR 0005 sans le remplacer.

## Contexte

L'ADR 0005 fixe le principe (cache local par profil, file d'actions, serveur arbitre). Il laisse ouverts : la forme de la clé d'un profil à PIN, ce qui est écrit sur l'appareil, l'idempotence des actions hors compta, le cache des images, la place du service worker face à la CSP à nonce, et l'appareil partagé. Ces choix touchent à la surprise (VIS-20) : un cache commun à l'appareil, lu par un autre profil, est un canal de sortie.

## Décision

### Clé de cache (OFF-26)

- `GET /profiles/me/cache-key` (profil actif déverrouillé, `no-store`) rend `{ encrypted: false }` pour un profil sans PIN, sinon `{ encrypted: true, keyId, key }`.
- `key` = HMAC-SHA-256(`CACHE_KEY_SECRET`, `"lh-cache-key|v1|" + profil + "|" + compte + "|" + empreinte du PIN`), 32 octets en base64url. `keyId` = les 16 premiers octets d'un HMAC distinct (`"lh-cache-id|v1|…"`), en hexadécimal : il peut être écrit sur l'appareil sans rien révéler de la clé.
- L'empreinte est celle du **déverrouillage de la session** (`Unlock.pinStamp`, PIN-05), et la route refuse si elle n'est plus celle du PIN courant. Aucune colonne nouvelle : un PIN changé, réinitialisé ou retiré, ou un profil passé dans un autre compte, change la clé d'elle-même.
- Côté client : `crypto.subtle.importKey('raw', …, 'AES-GCM', false, …)`, clé non extractible gardée dans la mémoire de l'onglet. Chaque écriture : IV aléatoire de 12 octets, données additionnelles = identifiant du profil et nom du magasin.

### Stockage sur l'appareil (OFF-06, OFF-28)

- Base `lh-device` : une ligne par profil (`profileId`, `accountId`, `encrypted`, `keyId`, `lastOpenedAt`), et le dernier profil actif. Rien d'autre.
- Base `lh-p-{profileId}` : magasins `cache` (un seul enregistrement : l'état déshydraté de TanStack Query, filtré), `images` (blobs, OFF-08) et `queue` (actions en file). Chiffrés si `encrypted`.
- Liste fermée des lectures persistées, par préfixe d'URL de la clé de requête générée par Orval ; tout le reste (session, compte, `/profiles/me*`, cercle, justificatif) reste en mémoire.
- Écriture du cache par lot, une seconde au plus après un changement ; relecture au montage du profil.

### File d'actions (OFF-11 à OFF-19)

- Une action en file porte : `kind`, clé d'idempotence, profil, date, requête (méthode, URL relative générée, corps JSON, `If-Match` éventuel), et de quoi l'afficher. Une action composée (ajouter un souhait à la main : fiche puis élément) porte une clé par étape.
- Le rejeu passe par le mutateur du client généré (`apiFetch`), donc par le CSRF et les en-têtes habituels ; une seule action à la fois, dans l'ordre.
- Les écrans affichent les actions en attente par-dessus les lectures (« à confirmer », « en attente d'envoi ») au lieu de modifier le cache de lecture : à la confirmation, la lecture est simplement relue.

### Idempotence générale (API-16)

- Un intercepteur de plateforme (`@Idempotent('opération')`) couvre les routes en file hors compta : ajout d'élément, modification et retrait, commentaire, réception, création de fiche. Clé exigée (`422 IDEMPOTENCY_KEY_REQUIRED`), même table `idempotency_record` que la compta, mêmes 30 jours.
- La compta garde son idempotence dans sa transaction (exactement une fois). Ailleurs, l'intercepteur **réserve** la clé avant d'exécuter (ligne au statut `0`), enregistre la réponse après, et efface la réservation si l'exécution échoue. Une réservation de plus de 2 minutes est reprise. Un arrêt du serveur entre l'écriture et l'enregistrement de la réponse peut donc laisser rejouer une seule fois une action non monétaire : risque accepté (un commentaire en double, jamais un montant).
- Les enregistrements échus sont purgés chaque jour (suite M4 de la revue de la phase 5).

### Service worker (PWA-07, OFF-24)

- Serwist (ADR 0005), pré-cache des seuls fichiers statiques du build et d'une page `/offline` statique, sans donnée ni nonce utile ; toute navigation est servie par le réseau, et par `/offline` en son absence. Aucune réponse de `/api` ni page rendue n'entre dans le cache du service worker.
- `/offline` monte le même client que l'application, qui lit le cache du profil et pousse la route demandée.

### Appareil partagé (OFF-30)

- Colonne `session.shared_device`, durée absolue 12 heures, glissante 2 heures, pas d'appareil de confiance ; exposée par `GET /session`. Côté client, aucune base IndexedDB n'est ouverte.

## Raisons

- Dériver la clé de l'empreinte du PIN évite une époque à tenir à jour en cinq endroits (création, changement, réinitialisation, retrait, passage de compte) et reprend la garantie déjà vérifiée de PIN-05.
- Garder la clé en mémoire seulement est ce qui rend le cache illisible à un autre profil du même appareil ; le prix (réseau requis après un rechargement) est celui de la décision du 2026-11-17.
- Afficher les actions en attente par-dessus les lectures, plutôt que de mettre à jour le cache par avance, évite une deuxième vérité à réconcilier et laisse l'API seule juge de la forme d'une vue (offreur ou destinataire).
- Les images d'une fiche peuvent révéler un cadeau : un cache commun du navigateur les montrerait à tous les profils de l'appareil.

## Conséquences

- Un profil à PIN n'est lisible hors ligne que dans l'onglet où il a été déverrouillé en ligne.
- Une page servie hors ligne est toujours l'enveloppe : le premier affichage hors ligne passe par elle, puis le routeur du client.
- L'intercepteur d'idempotence ajoute une écriture en base par action en file.

## Alternatives écartées

- **Époque de cache en colonne** : même effet, plus de points d'écriture à ne pas oublier.
- **Persisteur de TanStack (`persistQueryClient`) sur une base commune** : simple, mais une seule base pour l'appareil.
- **Mise à jour optimiste du cache de lecture** : plus fluide, mais oblige le client à fabriquer des vues, au risque d'afficher une donnée que l'API n'aurait pas rendue.
- **Pré-cache des pages HTML** : chaque page porte un nonce de CSP et peut dépendre de la session.
- **Idempotence par intercepteur pour la compta aussi** : la compta exige l'enregistrement dans la même transaction que l'écriture.
