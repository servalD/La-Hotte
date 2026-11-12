# Roadmap

Chaque phase livre quelque chose d'utilisable et de testé. On ne commence pas une phase tant que les critères de sortie de la précédente ne sont pas remplis.

## Choix du modèle par tâche

| Étiquette | Modèle | Quand |
|---|---|---|
| **opus** | Claude Opus 5.5 | Conception, découpage d'une phase en tâches, tout ce qui touche à l'authentification, au moteur de visibilité, à la compta, à l'extraction (SSRF, injection), au temps réel filtré ; revue de sécurité ; bug difficile |
| **sonnet** | Claude Sonnet 5.5 | Implémentation d'un cas d'usage déjà spécifié et découpé, écrans et composants, tests, CRUD, configuration, documentation |

Règle pratique : **Opus décide et vérifie, Sonnet exécute.** Une tâche `sonnet` doit pouvoir se faire en lisant une règle de spec et un fichier voisin ; si elle demande d'arbitrer, elle remonte en `opus`.

## Phase 0 — Socle

**État : livrée le 2026-11-12** (voir ADR 0010). Tests d'intégration verts contre PostgreSQL 17 et Redis 7 (Docker). Reste à constater sur GitHub : CI verte au premier envoi.

Objectif : un dépôt où tout changement passe par les mêmes contrôles.

| Tâche | Modèle |
|---|---|
| Monorepo, TypeScript strict, lint, formatage, règles d'architecture (QA-03) | sonnet |
| Docker Compose local (PostgreSQL, Redis), Prisma, première migration | sonnet |
| Squelette NestJS : module type à quatre couches, erreurs RFC 9457, validation, journalisation, santé | opus (le module type), sonnet (le reste) |
| Chaîne OpenAPI → Orval → `api-client`, vérification en CI (ADR 0009), essai sur une vue polymorphe | opus |
| Squelette Next.js : système de design, jetons, thèmes, i18n, composants de base, jetons d'animation | sonnet |
| CI complète (CI-01), en-têtes de sécurité, CSP | sonnet, revue opus |
| Tous les `CLAUDE.md` mis à jour avec les commandes réelles | sonnet |
| Trivy sur le dépôt en CI, action épinglée par commit, exceptions à échéance (CI-05 à CI-07) — ajouté le 2026-11-12 | sonnet |
| Épingler par commit les autres actions tierces du workflow (CI-07) | sonnet |

Sortie : une route d'exemple traverse les quatre couches, son client est généré, la CI est verte et refuse un import interdit.

## Phase 0 bis — Observabilité

Spec : `14` (OBS-01 à OBS-44), `09` (SEC-31). ADR 0012.

**À faire avant le premier code de la phase 1 qui manipule des mots de passe ou des sessions** : c'est là qu'une exception mal nettoyée fuit le plus. Les tâches 1 à 3 d'abord ; les suivantes peuvent s'intercaler.

| # | Tâche | Modèle |
|---|---|---|
| 1 | **Essai** : stack GlitchTip en local, coexistence SDK Sentry (`skipOpenTelemetrySetup`) et SDK OpenTelemetry sur NestJS 11 et Next 15, envoi de source maps par `glitchtip-cli`, relais `/monitoring`. Corriger l'ADR 0012 et OBS-30 à OBS-33 selon le résultat | opus |
| 2 | Profil Compose `obs` (OBS-44) : `otel-collector`, `openobserve`, `glitchtip-web`, `glitchtip-worker`, `postgres-obs`, configurations dans `ops/observability/` | sonnet |
| 3 | API : `instrument.ts` chargé en premier, `platform/telemetry` (SDK, exporteurs OTLP, Sentry), variables d'environnement validées, **module `scrub`** et filtre d'exceptions (5xx seulement, OBS-25), corrélation `trace_id` dans pino, port `Metrics` dans le noyau partagé | opus (scrub, filtre, port), sonnet (câblage) |
| 4 | **Test de non-fuite de la télémétrie (OBS-26)** : exporteurs de test, marqueurs, CI bloquante | opus |
| 5 | Web : `@sentry/nextjs` en erreurs seulement, `instrumentation.ts` pour les spans serveur, route `/monitoring` à liste blanche, CSP inchangée | sonnet, revue opus |
| 6 | CI et déploiement : build avec cartes, `glitchtip-cli` (inject puis upload) au déploiement seulement, suppression des cartes de l'artefact servi, release = SHA | sonnet |
| 7 | Squelettes de `worker` et `fetcher` : même `instrument.ts` (au fil des phases où ils naissent) | sonnet |
| 8 | Métriques métier au fil des phases : refus d'autorisation (phase 1), extraction et coût (phase 2), files (phase 4) | sonnet |
| 9 | Tableaux de bord et règles d'alerte versionnés (OBS-05, OBS-42), canal d'alerte hors application (OBS-43), sonde externe (OBS-41), restrictions d'accès (OBS-27), rétentions (OBS-16) | opus (alertes, accès), sonnet (tableaux de bord) : en phase 7 |

Sortie : critères d'acceptation « observabilité » de `14` pour l'API et le web ; test OBS-26 vert en CI ; `security-reviewer` sans point bloquant sur `scrub`.

## Phase 1 — Comptes, profils, authentification

Spec : `01`, `09`. ADR 0003, ADR 0011 (essai de Better Auth fait le 2026-11-12 : voie maison retenue).

| Tâche | Modèle |
|---|---|
| Découpage de la phase, modèle de session, essai rapide d'une bibliothèque d'authentification (ADR 0003) | opus |
| Inscription, vérification d'e-mail, connexion, sessions, révocation, limitation | opus |
| Google OIDC + PKCE, association de compte | opus |
| TOTP, codes de secours, ré-authentification | opus |
| Profils, sélection, PIN serveur, verrouillage | opus |
| Liens, cercle, invitations, blocage | sonnet, revue opus |
| Écrans : inscription, connexion, sélecteur de profil, réglages, sessions | sonnet |
| Tests de sécurité : énumération, CSRF, routes sans session | opus |

Sortie : critères d'acceptation de `01` ; revue `security-reviewer` sans point bloquant.

## Phase 2 — Articles, listes, visibilité

Spec : `02`, `03`, `04`. ADR 0004, 0007.

| Tâche | Modèle |
|---|---|
| **Moteur de visibilité** : types de vues, règles, matrice de tests générée (écrite avant le code) | opus |
| Service `fetcher` isolé et protections SSRF | opus |
| Extraction : données structurées, port `ProductExtractor`, adaptateur Claude, validation, brouillon | opus (port, prompt, validation), sonnet (analyseurs) |
| Fiches article, listes, éléments, rôles de liste, succession | sonnet, revue opus |
| Règles de visibilité par élément, journal des changements | opus |
| Écrans : listes, ajout par lien, photo, saisie, composant « Qui voit ça ? » | sonnet |
| Répertoire du cercle, fenêtre de publication (REP-06) | sonnet, revue opus |
| Jeu de pages figées et mesure de l'extraction | sonnet |

Sortie : matrice de visibilité verte ; tests de non-fuite sur toutes les routes de lecture ; tests SSRF verts.

## Phase 3 — Événements et giftlists

Spec : `03` (giftlists), `05`.

| Tâche | Modèle |
|---|---|
| Giftlists : exposition, absence de trace (GFT-07), tests de non-fuite | opus |
| Événements, invitations, réponses, audience | sonnet, revue opus |
| Reprise des souhaits non obtenus (EVT-22), événements surprise | opus |
| Assistant de réponse en trois étapes, pages d'événement | sonnet |
| Confirmation de réception (vue offreur bleu et vert, vue destinataire neutre et vert) | sonnet, revue opus |

Sortie : critères de `05` ; le destinataire d'une giftlist cachée ne peut rien observer.

## Phase 4 — Commentaires, notifications, temps réel

Spec : `06`. ADR 0006.

| Tâche | Modèle |
|---|---|
| Passerelle temps réel, salons, vérification d'abonnement, rattrapage | opus |
| Deux fils de commentaires, dépôts distincts, activité | opus |
| Notifications : génération par destinataire à travers le moteur de visibilité | opus |
| Web Push, résumé e-mail, préférences, heures calmes | sonnet |
| Écrans : fils, centre de notifications, présence | sonnet |
| Tests à deux clients (QA-13) | sonnet, cas écrits par opus |

Sortie : aucun événement d'offreur dans les trames d'un destinataire, sur tous les salons.

## Phase 5 — Compta

Spec : `07`.

| Tâche | Modèle |
|---|---|
| Domaine : participations, arrondis, journal, tests par propriétés | opus |
| Concurrence sur le reste, idempotence | opus |
| Acheteur, panier, achat, règlements | sonnet, revue opus |
| Écart de prix (CPT-16 à CPT-19) : répartition, reste à couvrir, notification sélective | opus |
| Soldes, compensation, budgets | sonnet, revue opus |
| Vue latérale, panier, comptes, animations associées | sonnet |

Sortie : critères de `07` ; le journal permet de reconstituer tout état.

## Phase 6 — Hors ligne, installation, motion

Spec : `08`, `10`. ADR 0005.

| Tâche | Modèle |
|---|---|
| Conception du cache cloisonné et chiffré, file de mutations, purge | opus |
| Service worker, persistance, rejeu, écran des actions non synchronisées | sonnet, revue opus |
| Résolution de conflits | sonnet |
| Manifeste, cible de partage, installation, pastille | sonnet |
| Passe de motion design sur tous les moments de `10`, mouvement réduit | sonnet |
| Audit d'accessibilité et corrections | sonnet |
| Tests de bout en bout hors ligne | sonnet |

Sortie : critères de `08` ; Lighthouse ≥ 90 ; les six parcours clés tenus.

## Phase 7 — Administration, catalogue global, mise en production

Spec : `11`, `14`. ADR 0008.

| Tâche | Modèle |
|---|---|
| Espace d'administration, permissions, journal d'audit | opus |
| Catalogue global, modération, signalements | sonnet, revue opus |
| Export et suppression des données | opus |
| Production : Compose, Caddy, sauvegardes, restauration testée, observabilité, alertes | sonnet, revue opus |
| Trivy sur chaque image construite avant publication ; rapport hebdomadaire planifié des images tierces (CI-05) | sonnet |
| Revue de sécurité complète et test d'intrusion ciblé sur la surprise (SEC-42) | opus |

Sortie : restauration réussie et chronométrée ; aucune fuite trouvée ; ouverture sur invitation.

## Après la v1

Dans l'ordre proposé, sous réserve de vos choix dans `15-suggestions.md` : groupes nommés, tirage au sort, passkeys, rappels d'anniversaire, historique des cadeaux, lien invité.

## Méthode de travail pour chaque phase

1. **Opus, mode plan** : relire les fichiers de spec de la phase, lever les questions ouvertes avec vous, découper en tâches petites et indépendantes, écrire les tests de non-fuite attendus.
2. **Sonnet** : implémenter tâche par tâche, tests compris.
3. **Opus** : `/security-review` et agent `security-reviewer` sur ce qui est sensible, `/code-review` sur le reste.
4. Mettre à jour la spec si une décision a changé, avant de fusionner.
