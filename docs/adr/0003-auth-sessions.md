# ADR 0003 — Authentification et sessions

**Statut :** accepté · 2026-11-11

## Contexte

Connexion par mot de passe et par Google, TOTP, plusieurs profils par compte avec PIN, révocation immédiate, application web et PWA sur la même origine.

## Décision

- **Sessions opaques côté serveur** : identifiant aléatoire en cookie `HttpOnly; Secure; SameSite=Lax`, haché en base, état en Redis avec persistance en PostgreSQL. Pas de JWT.
- La session porte : compte, profil actif, profils dont le PIN est validé, date de dernière ré-authentification, appareil de confiance.
- **Google** : OpenID Connect, flux code + PKCE, avec la bibliothèque `openid-client` ; vérification de `iss`, `aud`, `nonce`, `email_verified`.
- **Mots de passe et PIN** : argon2id.
- **TOTP** : `otplib`, secret chiffré par une clé hors base, fenêtre de ±1 pas, anti-rejeu.
- **CSRF** : `SameSite` + jeton à double soumission sur les mutations + vérification de `Origin`.
- Le web et l'API sont servis sous la **même origine** par le proxy (`/` et `/api`), ce qui évite les cookies inter-sites et simplifie CORS.
- Le module `identity` suit l'ADR 0002 ; les bibliothèques sont derrière des ports.

## Raisons

- Révocation immédiate et changement de profil sans réémission de jeton.
- Rien d'exploitable dans le stockage du navigateur en cas de XSS.
- Le PIN de profil s'exprime naturellement comme un état de session.

## Conséquences

- Une lecture Redis par requête (négligeable).
- Écrire soi-même l'assemblage de l'authentification est un risque : le module passe systématiquement par `security-reviewer`, s'appuie sur des bibliothèques éprouvées pour toute la cryptographie, et suit les aide-mémoire OWASP.

## Alternatives écartées

- JWT d'accès + rafraîchissement : révocation et état de profil compliqués, sans bénéfice sur une seule origine.
- Service d'identité externe (Auth0, Clerk) : dépendance et données hors UE, modèle multi-profils avec PIN à greffer de toute façon.
- Bibliothèque d'authentification complète (Better Auth, Auth.js) : à réévaluer au début de la phase 1 par un essai court ; le modèle compte / profils / PIN risque de la contourner plus que de l'utiliser.
