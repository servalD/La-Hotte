# ADR 0015 — Pré-session : reprise par `GET /session`, tirage neuf au départ vers Google

**Statut :** accepté · 2026-11-15

Précise l'ADR 0013, section « CSRF », paragraphe « Avant session ». Le reste de l'ADR 0013 est inchangé.

## Contexte

L'ADR 0013 dit l'identifiant de pré-session (`__Host-lh_presession`) « tiré par le serveur ». En pratique, rien n'en est stocké : le jeton CSRF de pré-session est un HMAC de l'identifiant. `GET /session` et le départ vers Google (`POST /auth/google/start`) reprenaient tout identifiant **bien formé** présenté par le navigateur. Les tests de fixation de la tranche 8 de la phase 1 l'ont mis en évidence ; la revue de sécurité du même jour (I3) en a évalué le risque.

Planter une pré-session depuis un autre site est impossible : le préfixe `__Host-` interdit l'attribut `Domain`, le cookie est `Secure` et `HttpOnly`, et toute mutation exige l'origine de l'application. Garder côté serveur la liste des identifiants tirés n'y changerait rien : un attaquant obtient un identifiant authentique par son propre `GET /session`.

Le cas réel est celui d'un **proche qui a eu l'appareil en main une fois** (ordinateur partagé, outils de développement) et a lu la pré-session `P` de la victime. Tant que la victime navigue sans session, `P` ne change pas : chaque `GET /session` la reprend et prolonge son cookie. Depuis sa machine, le proche obtient le jeton CSRF de `P`, démarre un parcours Google lié à `P` avec son propre compte Google, garde l'adresse de retour et l'envoie à la victime. Le retour (`GET /auth/google/callback`, seul `GET` qui modifie l'état, sans jeton CSRF possible) trouve `P` dans le navigateur de la victime : elle est connectée au compte du proche, qui voit ce qu'elle y fait ensuite (CSRF de connexion par OIDC).

## Décision

1. **`GET /session` reprend une pré-session bien formée.** Le jeton CSRF reste stable d'un onglet à l'autre. C'est sans danger pour les mutations, qui exigent aussi l'origine.
2. **Le départ vers Google tire toujours une pré-session neuve** et y lie le parcours. Sans session, le cookie de pré-session et le jeton CSRF qui la suit sont posés ensemble ; avec une session, seul le cookie de pré-session change, le jeton CSRF reste celui de la session. Une pré-session connue d'un tiers ne correspond donc à aucun parcours.
3. **Aucun autre service sur le même nom d'hôte**, même sur un autre port : un cookie `__Host-` ne tient pas compte du port. C'est une condition du déploiement (`14`).

## Raisons

- Le seul `GET` qui modifie l'état ne peut pas être protégé par un jeton CSRF. Sa liaison doit donc porter sur un secret que seul le navigateur qui a démarré le parcours a reçu, et que personne n'a pu lire avant.
- Tirer une pré-session à chaque départ coûte un cookie de plus. Le faire à chaque `GET /session` changerait le jeton CSRF sous les pieds des autres onglets, sans gain : les mutations sont déjà protégées par l'origine.

## Conséquences

- Un départ vers Google change le jeton CSRF de pré-session. Le client relit le jeton dans le cookie `__Host-lh_csrf` (`fetcher.ts`), donc sans changement côté web.
- Deux départs dans deux onglets : seul le dernier parcours aboutit, le premier retour reçoit `GOOGLE_FLOW_INVALID`. C'est accepté (cas rare, message clair à la page de retour).
- Test : `identity-security.spec.ts`, « la pré-session d'autrui ne lie pas un parcours Google ».

## Alternatives écartées

- **Stocker les pré-sessions tirées** (Redis) : n'empêche pas d'obtenir un identifiant authentique, et ajoute une écriture à chaque visite anonyme.
- **Faire tourner la pré-session à chaque `GET /session`** : casse le jeton CSRF des autres onglets, sans fermer davantage le cas du proche qui est déjà fermé par le point 2.
