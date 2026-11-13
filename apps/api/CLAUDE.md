# apps/api — NestJS

Spec : `docs/spec/12` (données), `13` (API), `14` (tests). Décisions : `docs/adr/0002`, `0003`, `0004`, `0009`.

## Couches

```
src/modules/<module>/
  domain/          entités, objets-valeur, règles, erreurs métier, ports
  application/     un cas d'usage par fichier : <verbe>-<objet>.use-case.ts
  infrastructure/  dépôts Prisma, mappeurs, clients externes
  presentation/    contrôleurs, DTO, gateways
  index.ts         seule surface importable par les autres modules
```

Sens des imports : `presentation → application → domain ← infrastructure`.

- `domain` n'importe ni NestJS, ni Prisma, ni aucune bibliothèque d'entrée-sortie.
- Un module n'importe d'un autre que son `index.ts`.
- Pas de logique métier dans un contrôleur, un dépôt ou un mappeur.
- Les entités du domaine ne sont pas les modèles Prisma.

Modules : `identity`, `catalog`, `lists`, `visibility`, `events`, `accounting`, `conversations`, `notifications`, `directory`, `admin`.

Hors modules :

```
src/shared/<couche>/   noyau partagé (DomainError, ports IdGenerator et Clock), mêmes règles de couches
src/platform/          technique : config, journaux, Prisma, Redis, erreurs RFC 9457, validation, santé, télémétrie
src/openapi/           construction et émission de openapi.json
src/bootstrap.ts       préfixe /api/v1, helmet, CORS ; partagé par main.ts et les tests de contrat
src/instrument.ts      Sentry et OpenTelemetry, chargé par `node --import` avant l'application (OBS-12)
```

`domain` et `application` n'importent jamais `platform` : ils passent par un port. La règle `architecture/layers` (`packages/config/eslint/rules/architecture.mjs`) vérifie tout cela ; les fichiers de test en sont exemptés.

### Module type : `src/modules/example`

Modèle à copier pour un nouveau module (phase 0, à retirer quand un vrai module l'aura remplacé) :

| Fichier                                 | Rôle                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `domain/example-item.ts`                | Entité pure : `create` (règles) et `restore` (relecture)                                                             |
| `domain/*.errors.ts`                    | `DomainError` avec `kind` (→ statut HTTP) et `code` stable                                                           |
| `domain/*.repository.ts`                | Port en classe abstraite (sert de jeton d'injection)                                                                 |
| `domain/*-projection.ts`                | Vues destinataire / offreur construites champ par champ. **Dans un vrai module, ce choix appartient à `visibility`** |
| `application/*.use-case.ts`             | Une classe, `execute` ; `application/contract.ts` = ce que la présentation peut importer                             |
| `infrastructure/prisma-*.repository.ts` | Adaptateur + mappeur ligne ↔ entité ; `in-memory-*` pour les tests                                                   |
| `presentation/`                         | Contrôleur mince, DTO `*.dto.ts`, vues `*.view.ts` (suffixes lus par le plugin Swagger)                              |
| `index.ts`                              | Surface publique                                                                                                     |

Réponse polymorphe : `@ApiExtraModels` + `oneOf` avec `discriminator` sur `view` (voir `getExampleItem`). L'`operationId` est le nom de la méthode du contrôleur et devient le nom du hook (`useGetExampleItem`) : le choisir unique et parlant (un doublon fait échouer l'émission).

Le contrôleur reçoit le profil actif par `@ActiveProfile()` ; faute de propriétaire, le lecteur y reste traité en destinataire.

### Session et gardes : `src/modules/identity` (ADR 0013)

Une garde globale (`IdentityGuardChain`) enchaîne session, CSRF, profil et ré-authentification. **Toute route porte exactement une marque** : `@Public()` (liste explicite, figée par `test/contract/identity-session.spec.ts`), `@AccountScope()` (espace Compte, métadonnées seulement) ou `@RequiresProfile()` (profil actif déverrouillé). Ajouter `@RequiresRecentReauth()` pour AUTH-14. Paramètres : `@CurrentSession()`, `@ActiveProfile()`, `@ClientContext()` (adresse retenue par `trust proxy`). Un module importe ces décorateurs depuis `modules/identity`.

Les autres modules n'en importent que `modules/identity` (décorateurs, `CheckSessionAccess`, `IdentityEvents`) : ni le magasin de sessions ni le cycle de vie. Les jetons des ports et les doubles en mémoire sont dans `modules/identity/testing`, réservé aux tests.

Tests : `createTestApp()` remplace les ports d'`identity` par leurs doubles en mémoire et fournit `identity.signIn({ pin, relock, withProfile })` ; `test/support/sign-in.ts` ouvre une session réelle (`createAccountWithProfile` puis `signIn`) pour l'intégration et la non-fuite. Une mutation porte `user.mutation` (cookie, `X-CSRF-Token`, `Origin`), une lecture `Cookie: user.cookie`.

## Ajouter un cas d'usage

1. Lire la règle de spec concernée.
2. Écrire le test du cas d'usage avec des ports en mémoire ; pour une lecture, écrire aussi le test de non-fuite.
3. Domaine, puis cas d'usage, puis dépôt, puis contrôleur et DTO.
4. `pnpm generate`, et versionner `openapi.json` et le client régénéré.

Prendre pour modèle le cas d'usage voisin le plus proche plutôt que d'inventer une forme.

## Règles

- **Lectures** : passer par `visibility`. Une réponse faite à un destinataire utilise un type `*RecipientView`, qui ne contient aucun champ d'offreur. Ne jamais rendre un champ facultatif pour « masquer » une donnée.
- **Profil actif** : lu dans la session par le décorateur prévu, jamais dans le corps ni l'URL.
- **Autorisation** : garde de rôle plateforme + politique de ressource (CASL) dans le cas d'usage. Refus par défaut.
- **`404` et non `403`** quand l'existence est un secret (listes, éléments, giftlists, événements surprise).
- **DTO** : contraintes explicites (longueurs, bornes, énumérations, formats) et annotations OpenAPI ; champs inconnus rejetés.
- **Mutations** : `Idempotency-Key` pris en charge ; `If-Match` sur les ressources versionnées.
- **Compta** : entiers en unités mineures ; transaction avec verrou sur l'élément ; écriture au journal dans la même transaction.
- **Temps réel** : émettre après validation de la transaction, par salon, à travers `visibility`. Aucune écriture par WebSocket.
- **Erreurs** : `application/problem+json` avec un `code` stable ; aucun détail interne.
- **Journaux et télémétrie** : pas de contenu de liste, de commentaire, de jeton ni de code (SEC-31), ni dans les traces, métriques ou rapports d'erreur (OBS-20). Tout passe par `platform/telemetry/scrub`. Les cas d'usage comptent via le port `Metrics`, jamais en important la bibliothèque ; ses noms sont une liste fermée (`metrics.port.ts`) et ses étiquettes une liste blanche (`code`, `kind`), jamais un montant : une nouvelle étiquette s'ajoute à `METRIC_ATTRIBUTE_ALLOW_LIST` dans `scrub.ts`, avec le contrôle de forme de sa valeur, sinon elle est retirée en silence. Un message d'exception n'interpole aucune donnée d'utilisateur. Seules les erreurs inattendues vont à GlitchTip (OBS-25). Journaliser le domaine d'une URL d'article, jamais l'URL.
- **SQL** : Prisma ou requêtes paramétrées ; aucune concaténation.
- **Appels sortants vers une URL d'utilisateur** : uniquement par le service `fetcher`.

## Commandes (dans `apps/api`)

`pnpm dev` et `pnpm start` (avec `--import ./dist/instrument.js` et `--enable-source-maps`), `pnpm test` (`*.spec.ts` : unitaires et `test/contract`), `pnpm test:integration` (`test/integration/*.int-spec.ts`, base réelle), `pnpm test:leak` (`test/leak/*.leak-spec.ts`, OBS-26 : construit, puis base réelle, faux collecteur et faux GlitchTip), `pnpm openapi` (émet `openapi.json` sans base, en mode aperçu), `pnpm db:migrate`.

Base : la CLI Prisma utilise `DATABASE_MIGRATION_URL` (propriétaire) ; l'application `DATABASE_URL` (rôle `wishlist_app`, sans droit sur le schéma, DAT-03). Les contraintes `CHECK` (DAT-01) s'ajoutent à la main dans le `migration.sql`. Clés : UUID v7 produits par le port `IdGenerator`.

## Tests

- Domaine et cas d'usage : Vitest, ports en mémoire, sans base.
- Dépôts et transactions : PostgreSQL et Redis réels en conteneurs.
- Chaque route : nominal, non connecté, interdit, validation. Modèle : `test/contract/example-items.spec.ts` et `createTestApp()`.
- `test/contract/openapi-schema.spec.ts` refuse tout champ d'offreur dans un schéma `*RecipientView` d'`openapi.json`.
- `test/leak/` (OBS-26) : toute nouvelle sortie de télémétrie (span, métrique, journal, rapport d'erreur) y ajoute un scénario avec marqueur ; une nouvelle barrière de `scrub` se vérifie en la retirant et en constatant que le test échoue.
- Chaque test cite l'identifiant de la règle qu'il vérifie.

## Modèle

Opus 5.5 pour `identity`, `visibility`, `accounting`, l'extraction, les gateways. Sonnet 5.5 pour le reste. Tout changement dans ces zones passe par `security-reviewer`.
