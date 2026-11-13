# 13 — API et temps réel

## Objectif

Fixer les conventions que toutes les routes et tous les événements respectent, pour que le client soit généré et jamais écrit à la main.

## Chaîne de contrat

```
DTO NestJS (classes + validation)
   └─▶ openapi.json            (émis par @nestjs/swagger, plugin CLI)
         └─▶ packages/api-client   (généré par Orval)
               ├─ client HTTP typé
               ├─ schémas Zod
               └─ hooks TanStack Query
```

- **API-01** Les DTO de `apps/api` sont la **seule source** du contrat. `openapi.json` et `packages/api-client` sont générés et versionnés dans le dépôt ; ils ne sont jamais modifiés à la main.
- **API-02** La CI régénère et échoue si le résultat diffère de ce qui est versionné.
- **API-03** Le serveur est la **seule autorité de validation**. Les schémas Zod générés servent au client pour typer, valider les formulaires au plus tôt et vérifier les réponses en développement ; ils ne portent pas les règles métier croisées (somme des parts, cohérence giftlist).
- **API-04** Chaque DTO déclare explicitement longueurs, bornes, formats et énumérations, pour que le Zod généré soit utile. Un DTO sans contraintes est refusé en revue.
- **API-05** Les événements WebSocket ne sont pas décrits par OpenAPI. Leurs schémas Zod sont écrits à la main dans `packages/api-client/src/realtime`, seul dossier non généré du paquet, et servent des deux côtés.

## Conventions REST

- **API-10** Préfixe `/api/v1`. JSON uniquement. Noms de ressources au pluriel, en anglais (`/lists`, `/items`, `/events`). Champs en `camelCase`.
- **API-11** Le profil actif vient de la **session**, jamais d'un paramètre. Changer de profil est un appel dédié (`POST /session/profile`) qui vérifie le PIN.
- **API-12** Lectures filtrées par le moteur de visibilité : la forme de la réponse dépend du demandeur. Les DTO de réponse distinguent explicitement la vue destinataire et la vue offreur (`ItemRecipientView`, `ItemGiverView`) plutôt que d'avoir des champs facultatifs : un champ d'offreur ne peut pas se retrouver par erreur dans une vue destinataire, le typage l'interdit.
- **API-13** Codes : `200`, `201`, `204` ; `400` validation ; `401` non connecté ; `403` connecté mais interdit (quand l'existence n'est pas un secret) ; `404` introuvable **ou** interdit (SEC-04) ; `409` conflit ; `412` version dépassée ; `422` règle métier ; `423` profil verrouillé par PIN (`PROFILE_LOCKED`) ; `429` plafond atteint. Codes propres à la session (ADR 0013) : `401 REAUTH_REQUIRED` (ré-authentification de plus de 10 minutes, AUTH-14), `403 CSRF_REJECTED`.
- **API-14** Erreurs au format `application/problem+json` (RFC 9457) : `type`, `title`, `status`, `code` (stable, exploitable par le client : `CONTRIBUTION_EXCEEDS_REMAINING`), `detail` traduisible, `errors[]` par champ. Jamais de trace d'exécution ni de détail interne.
- **API-15** Pagination par curseur (`?cursor=&limit=`), 50 éléments au plus. Réponse : `{ items, nextCursor }`.
- **API-16** **Idempotence** : toute mutation accepte l'en-tête `Idempotency-Key` (obligatoire pour la compta et pour toute action pouvant être mise en file hors ligne). Même clé + même corps = même réponse rejouée ; même clé + corps différent = `409`.
- **API-17** **Concurrence** : les ressources modifiables portent `version`. Une modification envoie `If-Match` ; version dépassée = `412` avec l'état courant, pour l'écran de résolution (OFF-14).
- **API-18** Plafonds par profil, compte et IP, annoncés par les en-têtes `RateLimit-*`.
- **API-19** Toute évolution est compatible : on ajoute des champs facultatifs, on ne renomme ni ne retire rien dans `v1`. Une rupture passe par `v2`, les deux versions cohabitant le temps que les clients installés se mettent à jour (un client hors ligne peut avoir plusieurs jours de retard).
- **API-20** Chaque réponse porte la version minimale du client acceptée ; un client trop ancien affiche « mise à jour nécessaire » au lieu d'échouer de façon obscure.
- **API-21** Toute mutation porte l'en-tête `X-CSRF-Token`, recopié du cookie `__Host-lh_csrf` par le mutateur du client (`packages/api-client/src/http/fetcher.ts`), et vient de la même origine (`Sec-Fetch-Site`, `Origin`). Avant session, le jeton s'obtient par `GET /session`. Seul le retour OIDC (`GET /auth/google/callback`) échappe à cette règle, avec sa propre protection ; aucun autre `GET` ne modifie l'état. Le client pose `X-User-Activity` sur les seules actions de l'utilisateur (navigation, clic), jamais sur un rafraîchissement automatique : c'est ce qui prolonge le déverrouillage d'un profil. Les réponses de session, d'authentification et de l'espace Compte portent `Cache-Control: no-store`. Détail : ADR 0013.

## Ressources principales

| Domaine | Routes (extrait) |
|---|---|
| Authentification | `POST /auth/register`, `/auth/email/verify` (vérification et confirmation d'un changement, selon le jeton), `/auth/email/cancel` (AUTH-16), `/auth/login`, `/auth/logout`, `POST /auth/google/start`, `GET /auth/google/callback` (seul `GET` qui modifie l'état, ADR 0013), `POST /auth/google/link`, `/auth/totp/enroll`, `/auth/totp/verify`, `/auth/totp/disable`, `/auth/recovery-codes`, `/auth/reauth`, `/auth/password/reset`, `/auth/password/reset/confirm`, `PUT /auth/password`, `PUT /auth/email` |
| Session | `GET /session` (public : état de la session ou de la pré-session, jeton CSRF), `POST /session/profile`, `POST /session/lock`, `GET /sessions`, `DELETE /sessions/{id}` |
| Espace Compte (PIN-08, métadonnées seulement) | `GET /account`, `GET /trusted-devices`, `DELETE /trusted-devices/{id}`, `GET/POST /account/profiles`, `DELETE /account/profiles/{id}`, `PUT /account/profiles/{id}/pin/reset`, `DELETE /account/profiles/{id}/pin` |
| Profil actif | `GET/PATCH /profiles/me`, `PUT /profiles/me/pin`, `POST /profiles/me/export`, `GET /circle`, `POST /links`, `POST /links/{id}/accept`. Aucune route de profil ne prend l'identifiant d'un profil : elle agit sur le profil actif (ADR 0013) |
| Articles | `POST /products` (lien, photo ou saisie), `GET/PATCH /products/{id}`, `PUT /products/{id}/share` |
| Listes | `GET/POST /lists`, `GET/PATCH/DELETE /lists/{id}`, `GET/POST /lists/{id}/items`, `PUT /lists/{id}/members/{profileId}` |
| Éléments | `GET/PATCH/DELETE /items/{id}`, `PUT /items/{id}/visibility`, `POST /items/{id}/received`, `POST /items/{id}/withdraw` |
| Événements | `GET/POST /events`, `GET/PATCH /events/{id}`, `POST /events/{id}/invitations`, `PUT /events/{id}/rsvp`, `GET /events/{id}/carry-over` |
| Compta | `PUT /items/{id}/contribution`, `DELETE /items/{id}/contribution`, `PUT /items/{id}/buyer`, `POST /items/{id}/purchase`, `PUT /contributions/{id}/settlement`, `GET /cart`, `GET /balances`, `GET/PUT /budgets` |
| Échanges | `GET/POST /items/{id}/comments?thread=`, `PATCH/DELETE /comments/{id}`, `GET /notifications`, `POST /notifications/read`, `PUT /notification-preferences`, `POST /push-subscriptions` |
| Répertoire | `GET /directory?scope=circle\|global&q=`, `POST /reports` |
| Synchronisation | `GET /sync?since=` (événements manqués, RT-06) |
| Administration | `/admin/...` (espace séparé, `11-admin-rbac.md`) |

`PUT /products/{id}/share` renvoie `422` avec le code `HIDDEN_ITEM_REQUIRES_CHOICE` si la fiche est liée à un élément caché et que la requête ne porte pas le choix explicite de REP-06.

## Temps réel

- **API-30** Socket.IO sur `/realtime`, authentifié par le cookie de session à la poignée de main, origine vérifiée.
- **API-31** Abonnement : `subscribe { room }` → accusé `ok` ou `denied`. Les salons sont décrits en RT-02 et RT-03.
- **API-32** Enveloppe d'un événement serveur : `{ type, id, seq, at, data }`. `seq` est croissant par profil.
- **API-33** Événements :

| Type | Salon | Contenu |
|---|---|---|
| `item.updated`, `item.created`, `item.removed` | `liste:{id}` | Vue filtrée de l'élément, ou identifiant seul |
| `product.extracted` | `profil:{id}` | Fiche brouillon complétée |
| `comment.created`, `comment.updated`, `comment.deleted` | `élément:{id}:public` ou `:offreurs` | Commentaire |
| `contribution.changed`, `purchase.changed`, `settlement.changed` | `élément:{id}:offreurs` | État de financement |
| `presence.changed`, `typing` | `élément:{id}:offreurs` | Profils présents |
| `notification.created` | `profil:{id}` | Notification |
| `access.revoked` | `profil:{id}` | Ressource à purger du cache (RT-07) |
| `event.updated`, `rsvp.changed` | `événement:{id}` | Événement |

- **API-34** Le client ne fait **aucune** mutation par WebSocket, sauf `typing` et `presence`. Toutes les écritures passent par l'API REST, où s'appliquent validation, idempotence et autorisation.
- **API-35** Plusieurs instances de l'API : adaptateur Redis de Socket.IO. L'émission se fait après validation de la transaction en base (pas d'événement pour une écriture annulée).

## Critères d'acceptation

- `pnpm generate` sur une branche propre ne produit aucune différence.
- Aucune vue destinataire (`*RecipientView`) ne contient de champ nommé `contribution`, `buyer`, `settlement`, `giver` ; un test de schéma le vérifie sur `openapi.json`.
- Une même requête de compta envoyée deux fois avec la même clé produit une seule écriture au journal.
- Un client d'une version antérieure encore prise en charge fonctionne après un déploiement.

## Questions ouvertes

1. Documentation interactive de l'API (Swagger UI) : exposée en développement seulement.
2. API publique pour des tiers : hors périmètre.
