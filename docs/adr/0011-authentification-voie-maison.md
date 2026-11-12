# ADR 0011 — Authentification : essai de Better Auth, voie maison retenue

**Statut :** accepté · 2026-11-12

## Contexte

L'ADR 0003 a fixé l'architecture de l'authentification (sessions opaques côté serveur, argon2id, TOTP, Google OIDC + PKCE) et demandé, au début de la phase 1, un essai court d'une bibliothèque complète (Better Auth, Auth.js) avant de l'écrire soi-même.

L'essai a porté sur Better Auth 1.7.22 (version stable, compatible Prisma 6), dans un prototype jetable sur la branche `spike/better-auth` (commit `f645318`, non fusionnée), contre PostgreSQL réel : plugins `two-factor` et `haveibeenpwned`, hachage argon2id, champs de session supplémentaires, cartographie des tables sur celles de `12-modele-de-donnees.md`.

## Décision

**Le module `identity` est écrit dans le dépôt**, sur les briques de l'ADR 0003 : `@node-rs/argon2`, `otplib`, `openid-client`, `nodemailer`, derrière des ports. Better Auth n'est pas adopté.

Le plan de la phase 1 (`docs/roadmap.md`, tranches 1 à 7) reste celui de la voie maison.

## Résultats de l'essai

| Critère | Résultat |
|---|---|
| Contrat d'API (API-01) | Réalisable : nos contrôleurs et DTO appellent `auth.api.*`. Mais les routes ne sont pas des DTO NestJS et il faut tout de même écrire une quinzaine de contrôleurs |
| Architecture à ports (QA-03) | Réalisable, mais les ports resteraient minces et la bibliothèque porterait l'essentiel du comportement |
| État de profil en session | Réussi : profil actif, profils déverrouillés, date de ré-authentification lus et écrits |
| Révocation immédiate (AUTH-05) | Réussie, cache de cookie désactivé |
| UUID v7, noms en snake_case | Réussi pour `user`, `session`, `account` ; `twoFactor` et `verification` demandent un mapping de plus |
| Argon2id, mots de passe compromis, anti-énumération à l'inscription, CSRF | Réussis |
| Rejeu d'un code TOTP (AUTH-11) | **Échec** : le même code a été accepté deux fois. Correctif possible par un hook global écrit par nous |
| Jeton de session haché en base (ADR 0003) | **Échec** : stocké en clair. Piste : sessions dans Redis seul avec clés hachées par nous |
| Codes de secours hachés (SEC-22) | **Écart** : chiffrés, non hachés |
| Délai croissant de la limitation (AUTH-07) | **Écart** : fenêtre fixe |
| Appareil de confiance révocable (AUTH-12) | **Écart** : cookie signé sans état, aucun appareil révocable côté serveur |
| Vocabulaire et modèle | `user` y désigne notre `account` et `account` notre `auth_identity` ; le mot de passe y vit dans `auth_identity`, la spec le place sur `account` |

## Raisons

- Le produit protège un secret, la surprise, contre des proches qui ont un compte légitime. Trois écarts touchent directement la sécurité des sessions et du second facteur (rejeu, jeton en clair, codes de secours). Les corriger revient à écrire par-dessus la bibliothèque du code sensible qui dépend de ses noms de routes et de son comportement interne.
- Le rythme de publication (versions stables presque quotidiennes, 1.8 en bêta) oblige à épingler la version et à relire chaque montée, avec des correctifs qui peuvent casser en silence.
- La bibliothèque ne connaît ni profils, ni PIN, ni profils enfants, ni cercle : cette part, la plus spécifique, reste à écrire dans tous les cas. L'économie réelle se limite aux flux classiques (inscription, vérification, réinitialisation, TOTP, Google), bien couverts par des briques éprouvées.
- La spec est respectée à la lettre : aucun ajustement de `01`, `09` ou `12` n'est imposé par une bibliothèque.

## Conséquences

- La phase 1 reste la plus lourde du projet : sessions, CSRF, limiteur, TOTP, Google et liens sont à écrire, à tester et à faire relire par `security-reviewer`.
- Toute cryptographie passe par des bibliothèques éprouvées (argon2, otplib, `node:crypto` pour AES-GCM) ; jamais d'algorithme écrit à la main.
- Les ports (`SessionStore`, `PasswordHasher`, `TotpService`, `OidcClient`, `MailSender`, `RateLimiter`, `PasswordBreachChecker`) permettent de remplacer une brique, ou de revenir sur cette décision, sans toucher au domaine.
- Le prototype n'est pas repris. Il reste consultable sur `spike/better-auth` comme référence des flux (ordre des appels de vérification, du second facteur et de la liaison Google).

## Alternatives écartées

- **Better Auth avec correctifs** (recommandation de l'essai) : économie estimée à 40 % de la phase, mais trois correctifs de sécurité à maintenir sur une base mouvante.
- **Better Auth sans écart de spec** : exige de corriger aussi les codes de secours et les appareils de confiance ; l'économie devient faible.
- **Auth.js** : non essayé ; son modèle centré sur un utilisateur unique et ses sessions JWT par défaut s'accordent encore moins avec les profils et le PIN en session.
