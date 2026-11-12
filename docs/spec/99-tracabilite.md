# 99 — Traçabilité avec la demande d'origine

Chaque exigence de la demande initiale, et l'endroit où elle est spécifiée. À relire en premier pour vérifier que rien n'a été oublié ni mal compris.

| # | Demande d'origine | Couvert par | Remarque |
|---|---|---|---|
| 1 | Application web et mobile | `08` PWA-01 à PWA-11 | Une seule PWA installable ; pas d'application native en v1 |
| 2 | Créer une liste de souhaits par profil | `03` WSH-01, WSH-02 | Liste « Mes envies » créée d'office |
| 3 | Renseigner un lien de n'importe quel vendeur, en ligne ou pas | `02` EXT-01 à EXT-20 | Hors ligne = photo ou saisie |
| 4 | Une IA crée la fiche : nombre, coût unitaire, coût final, illustration, description, URL | `02` ART-01, ART-10, EXT-30 ; ADR 0007 | Brouillon confirmé par l'utilisateur |
| 5 | Plusieurs profils par compte (familles avec un seul e-mail) | `01` PRO-01 à PRO-06 | |
| 6 | Code PIN par profil pour empêcher les autres de modifier les souhaits | `01` PIN-01 à PIN-08 | Vérifié côté serveur ; limite PIN-06 à lire |
| 7 | Souhaits visibles seulement de certaines personnes, tous par défaut | `04` VIS-10 à VIS-16 | |
| 8 | Créer un événement, y inviter des profils | `05` EVT-01 à EVT-14 | |
| 9 | En répondant, reprendre des souhaits non obtenus des listes précédentes | `05` EVT-20 à EVT-22, EVT-26 ; `03` LST-14 | Non obtenu = pas coché « reçu » par le destinataire |
| 10 | Chercher dans les listes accessibles des autres pour ajouter des articles | `05` EVT-20, EVT-23 ; `04` VIS-40 | Copie de la fiche |
| 11 | Wishlist globale dans le profil, sans événement | `03` WSH-02 | |
| 12 | Wishlist partagée avec un autre profil | `03` WSH-02, WSH-05 | Tous co-destinataires |
| 13 | Articles rendus accessibles dans un répertoire, pas par défaut | `04` REP-01 à REP-08 | Deux niveaux : cercle et catalogue global |
| 14 | Popup si l'article est caché : le rendre visible ou le partager à des personnes précises | `04` REP-06 ; `13` (`HIDDEN_ITEM_REQUIRES_CHOICE`) | Imposé aussi côté serveur |
| 15 | Liste blanche par liste déroulante, modifiable plus tard, et liste noire | `04` VIS-10, VIS-13 ; `10` UX-20 à UX-24 | Un seul composant, deux modes |
| 16 | Liste blanche ou noire modifiable seulement par les rôles autorisés ; par défaut le créateur, sinon le responsable | `03` LST-02 à LST-04 ; `04` VIS-14 | Précision apportée lors de la validation du plan |
| 17 | Giftlists faites par d'autres pour un profil, secrètes par défaut | `03` GFT-01, GFT-07 | |
| 18 | Paramétrable : exposer ou non l'existence ; contenu caché, partiel ou complet | `03` GFT-03 à GFT-05 | |
| 19 | Giftlist pour plusieurs comptes à la fois | `03` GFT-02 | Reformulé : plusieurs **profils** destinataires |
| 20 | Fil de commentaires par élément, façon ticket Jira | `06` COM-01 à COM-10 | Deux fils : public et offreurs |
| 21 | Compta façon Tricount : part précise, pourcentage ou intégralité | `07` CPT-01 à CPT-07 | |
| 22 | Vue latérale hiérarchisée de ce qu'on offre à qui, suivi du budget | `07` CPT-40 à CPT-45 | |
| 23 | Un profil chargé de l'achat, qui coche l'achat dans son panier | `07` CPT-10 à CPT-15 | |
| 24 | Il coche la part des autres quand ils ont avancé ou remboursé | `07` CPT-20 à CPT-24 | |
| 25 | Article acheté = supposé reçu (bleu) ; confirmé par le receveur (vert) | `03` LST-12, LST-13, LST-16, LST-17 ; `10` UX-30 | Bleu visible des seuls participants (décision du 2026-11-12) |
| 26 | Temps réel pour notifications et commentaires | `06` NOT-01 à RT-07 ; ADR 0006 | |
| 27 | Simple et clair malgré la complexité, bons réglages par défaut | `10` UX-01 à UX-08 ; tableaux « Valeurs par défaut » de chaque fichier | |
| 28 | Suggestions de fonctionnalités | `15` | |
| 29 | Clarifier les incohérences | Tableau ci-dessous | |
| 30 | TypeScript, NestJS, Next.js, architecture propre | `14` QA-01 à QA-06 ; ADR 0001, 0002 | |
| 31 | PostgreSQL | `12` | |
| 32 | RBAC admin et utilisateurs, est-ce cohérent ? | `11` | Oui, complété par des politiques de ressource |
| 33 | Offline first, réactive, installable | `08` ; ADR 0005 | Cache et file d'attente, serveur arbitre |
| 34 | Sécurité critique | `09` ; exigences réparties dans chaque fichier | |
| 35 | Motion design | `10` MOT-01 à MOT-12 | |
| 36 | Connexion avec Google | `01` AUTH-01, AUTH-03 ; ADR 0003 | |
| 37 | TOTP pour la double authentification | `01` AUTH-10 à AUTH-14 | |
| 38 | Modifier les informations de profil | `01` PRO-02, PRO-03 | |
| 39 | OpenAPI avec NestJS pour générer le Zod | `13` API-01 à API-05 ; ADR 0009 | Précision apportée lors de la validation du plan |
| 40 | Choisir les bons skills | `CLAUDE.md` (section Skills), agents | |
| 41 | `CLAUDE.md` aux bons endroits | Racine, `apps/api`, `apps/web`, `packages/api-client`, `docs` | |
| 42 | Directives Opus 5.5 / Sonnet 5.5 pour optimiser les crédits | `CLAUDE.md`, `.claude/agents/`, `.claude/settings.json`, `docs/roadmap.md` | |
| 43 | Auto-hébergé : GlitchTip (alertes d'exceptions TypeScript, source maps, SDK Sentry) et OpenObserve (journaux, métriques, traces OpenTelemetry de toute la pile), code adapté | `14` OBS-01 à OBS-46, DEP-02 ; `09` SEC-31, SEC-32, RGPD-03 ; ADR 0012 ; `roadmap.md` phase 0 bis | Demande du 2026-11-12. Ajout : nettoyage de la télémétrie (OBS-20 à OBS-27), car un rapport d'erreur peut révéler une surprise. Essai du 2026-11-12 (OBS-12, OBS-28 à OBS-35, ADR 0012) : GlitchTip 7 sans worker, Sentry 11 à fermer explicitement, source maps par script de bundle maison car `glitchtip-cli upload` est cassé. Tâche 3 (OBS-45) : le message d'une erreur tierce fuyait par les cadres de pile, y compris pour les exceptions non gérées (revue de sécurité) ; seuls des cadres de confiance passent désormais |
| 44 | Analyse Trivy dans la CI | `14` CI-05 à CI-07 ; `09` SEC-41 ; `.github/workflows/ci.yml` (job `trivy`) ; `roadmap.md` phases 0 et 7 | Demande du 2026-11-12. Ajout : action épinglée par commit, la CI de Trivy ayant elle-même été compromise en mars 2026 |

## Incohérences et manques relevés dans la demande

| Sujet | Problème | Résolution |
|---|---|---|
| Compte ou profil | La demande parle tantôt de comptes, tantôt de profils (invitations, giftlists) | Tout le social vise des profils (`00` glossaire) |
| Liste blanche et liste noire | Deux mécanismes demandés pour le même besoin | Un champ à trois valeurs (VIS-10) |
| « Accessible à tous » | Tous les utilisateurs, ou tous mes proches ? | Deux niveaux au choix (REP-02) |
| Surprise | Rien n'empêchait un destinataire de lire les réservations et commentaires sous ses souhaits | Règle de surprise (VIS-20) et double fil (COM-01) |
| PIN | Présenté comme une protection, mais le compte est partagé | Vérifié côté serveur ; limite documentée (PIN-06) |
| « Souhaits non obtenus » | Comment le savoir sans révéler les achats en cours ? | Défini par ce que le destinataire a coché « reçu » (LST-14, EVT-22, EVT-26) |
| Vendeur hors ligne | Pas de lien à analyser | Photo ou saisie (EXT-10, EXT-20) |
| RBAC | Ne suffit pas pour les droits par liste | Deux étages (`11`) |
| Compta « façon Tricount » | Mouvement d'argent réel ou suivi ? | Suivi uniquement (`07`) |
| Offline first et sécurité | Un cache local peut contenir des surprises | Cache cloisonné, chiffré, purgé (OFF-20 à OFF-25) |
| Notifications sur téléphone familial | Une notification peut révéler un cadeau | Notifications neutres (NOT-06) |

## Décisions prises le 2026-11-12

| Question | Décision | Règles |
|---|---|---|
| Quand le destinataire voit-il le bleu ? | Jamais : seuls les participants le voient | LST-12, LST-16 |
| Le destinataire peut-il savoir qu'un souhait est réservé ? | Non, d'aucune façon | LST-17 |
| Un souhait secrètement acheté est-il reproposé à la reprise ? | Oui, tant que le destinataire ne l'a pas coché « reçu » | LST-14, EVT-22, EVT-26 |
| Qui gère les PIN ? | Chaque profil change le sien avec l'ancien PIN ; réinitialiser ou désactiver se fait dans l'espace Compte avec ré-authentification | PIN-04, PIN-05, PIN-08 |
| Bibliothèque d'authentification | Essai de Better Auth fait ; voie maison retenue (rejeu TOTP, jeton de session en clair, codes de secours chiffrés, appareils de confiance non révocables) | ADR 0011 ; AUTH-04, AUTH-11, AUTH-12 |
| Notification d'un PIN erroné avant la phase 4 | Journal de sécurité + e-mail au compte ; notification dans l'application en phase 4 | PIN-03 |
| Lien demandé par un profil enfant | Statut `AWAITING_GUARDIAN` jusqu'à validation par un profil non-enfant du compte | PRO-05 |
| Écart de prix à l'achat | Réparti sur les parts en Tout ou Pourcentage ; sinon reporté sur le dernier participant, qui peut refuser une hausse ; reste à couvrir avec notification sélective | CPT-16 à CPT-19 |

## Décisions restant à prendre

1. Profil à PIN hors ligne (`08` Q1) : réseau requis pour rouvrir après verrouillage ?
2. Catalogue global dès la v1 ou après rodage (`04` Q2) ?
3. Inscriptions ouvertes ou sur invitation au lancement (`11` Q2) ?
4. Suggestions à retenir (`15`).
5. Identité visuelle : nom, logo, palette (`10` Q1).
