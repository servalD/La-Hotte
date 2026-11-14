# 09 — Sécurité et protection des données

## Objectif

Fixer les exigences de sécurité vérifiables. La référence est OWASP ASVS niveau 2 ; ce document liste ce qui est propre au produit et les contrôles obligatoires.

## Ce qu'on protège

| Actif                                  | Pourquoi                                                            |
| -------------------------------------- | ------------------------------------------------------------------- |
| **La surprise** (qui offre quoi à qui) | Propre au produit ; une fuite est irréversible.                     |
| Les identifiants et sessions           | Prise de contrôle de compte.                                        |
| Les données de mineurs                 | Obligation légale et morale.                                        |
| La compta                              | Litiges d'argent entre proches.                                     |
| Les envies et le réseau familial       | Données personnelles révélatrices (goûts, santé, religion, moyens). |

## Modèle de menaces

| Menace                                                        | Exemple                                                                                                          | Parades                                                                                                                                                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Curiosité interne** : un destinataire veut voir ses cadeaux | Appels directs à l'API, écoute du WebSocket, inspection du cache, changement de profil sur le téléphone familial | Moteur de visibilité (VIS-30), salons séparés (RT-03), champs absents, PIN serveur (PIN-02), cache cloisonné et chiffré (OFF-20, OFF-21), notifications neutres (NOT-06) |
| **Accès à la ressource d'autrui** (IDOR)                      | Deviner l'identifiant d'une liste                                                                                | Identifiants non devinables (UUID v7), contrôle d'accès systématique par le moteur, réponse `404` identique pour « n'existe pas » et « pas le droit »                    |
| **Prise de compte**                                           | Bourrage d'identifiants, hameçonnage                                                                             | argon2id, mots de passe compromis refusés, TOTP, limitation, alertes de connexion, révocation de sessions                                                                |
| **SSRF** par l'extraction de lien                             | URL vers le réseau interne                                                                                       | EXT-40 à EXT-45                                                                                                                                                          |
| **Injection de prompt** par une page marchande                | Texte piégé dans une page                                                                                        | EXT-31 : pas d'outil, sortie validée, brouillon confirmé                                                                                                                 |
| **XSS**                                                       | Titre de produit ou commentaire piégé                                                                            | Échappement systématique, aucune injection HTML, CSP stricte                                                                                                             |
| **CSRF**                                                      | Site tiers qui déclenche une action                                                                              | Cookies `SameSite`, jeton anti-CSRF sur les mutations, vérification de l'en-tête `Origin`                                                                                |
| **Abus d'invitation**                                         | Liens d'invitation devinés ou diffusés                                                                           | Jetons aléatoires de 128 bits, usage limité, expiration, révocation                                                                                                      |
| **Énumération**                                               | Découvrir si un e-mail a un compte                                                                               | Réponses et délais identiques                                                                                                                                            |
| **Abus de ressources**                                        | Extraction en masse, envoi massif d'invitations                                                                  | Plafonds par profil, compte et IP                                                                                                                                        |
| **Administrateur trop curieux**                               | Lecture des listes privées                                                                                       | Pas d'accès aux contenus, journal d'audit immuable (`11-admin-rbac.md`)                                                                                                  |
| **Fuite de la base ou d'une sauvegarde**                      | Vol d'un export                                                                                                  | Chiffrement au repos, secrets TOTP chiffrés par clé externe, sauvegardes chiffrées                                                                                       |
| **Dépendance compromise**                                     | Paquet npm malveillant                                                                                           | Verrouillage des versions, audit et analyse Trivy en CI, actions de CI épinglées par commit (CI-07), mises à jour revues, scripts d'installation désactivés              |

## Exigences

### Contrôle d'accès

- **SEC-01** Refus par défaut : toute route exige une session, sauf liste explicite de routes publiques.
- **SEC-02** Autorisation en deux étages : rôle plateforme (RBAC) puis politique de ressource. Toujours côté serveur.
- **SEC-03** Une route ne fait jamais confiance à un identifiant de profil fourni par le client sans vérifier qu'il appartient au compte de la session et que son PIN est validé.
- **SEC-04** `404` et non `403` quand l'existence même d'une ressource est une information (listes, éléments, giftlists, événements surprise).
- **SEC-05** Les réponses d'un même point d'API ne diffèrent ni par leur forme ni de manière exploitable par leur durée selon qu'une ressource cachée existe ou non.

### Entrées et sorties

- **SEC-10** Toute entrée est validée par schéma à la frontière de l'API : types, longueurs, formats, valeurs autorisées. Les champs inconnus sont rejetés.
- **SEC-11** Requêtes paramétrées uniquement. Aucune requête SQL construite par concaténation.
- **SEC-12** Téléversements : type vérifié sur le contenu, taille limitée, image réencodée, métadonnées supprimées, stockage hors de la racine web, nom de fichier généré.
- **SEC-13** En-têtes : `Content-Security-Policy` sans `unsafe-inline` pour les scripts (nonces), `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictive, `frame-ancestors 'none'`.
- **SEC-14** CORS : seule l'origine de l'application web est autorisée, avec identifiants.

### Secrets et chiffrement

- **SEC-20** TLS 1.2 minimum partout, y compris entre conteneurs exposés. HSTS avec préchargement.
- **SEC-21** Aucun secret dans le dépôt, les images ou les journaux. Secrets fournis par l'environnement d'exécution, renouvelables sans redéploiement de code.
- **SEC-22** Chiffrement applicatif pour : secrets TOTP, codes de secours (hachés), jetons Google, clés de chiffrement de cache. Clé maîtresse hors base, rotation prévue. Mise en œuvre : AES-256-GCM, trousseau `SECRET_ENCRYPTION_KEYS` (`id:clé`, clés de 32 octets) fourni par l'environnement ; la première clé chiffre, toutes déchiffrent ; le chiffré porte l'identifiant de sa clé, et l'en-tête comme le compte propriétaire sont authentifiés (un chiffré recopié sur un autre compte ne se déchiffre pas). L'identifiant 0 est réservé au développement et refusé en production. Les codes de secours (80 bits) sont stockés en SHA-256, comme les jetons de session : leur entropie rend un hachage lent inutile.
- **SEC-23** Base de données et sauvegardes chiffrées au repos. Sauvegardes quotidiennes, test de restauration mensuel.

### Journalisation et détection

- **SEC-30** Journal de sécurité : connexions, échecs, changements de moyens d'authentification, réinitialisations de PIN, refus d'autorisation, actions d'administration, tentatives d'abonnement refusées (RT-03). Les refus CSRF y sont écrits une fois par minute au plus pour chaque couple (adresse, compte visé ou anonyme), pour qu'un anonyme ne remplisse pas une table en ajout seul ; Redis indisponible, ils ne sont pas écrits (le refus, lui, est maintenu).
- **SEC-31** Les journaux ne contiennent ni mot de passe, ni code, ni jeton, ni contenu de liste ou de commentaire. La règle vaut pour toute la télémétrie : traces, métriques, rapports d'erreur (`14`, OBS-20 à OBS-27).
- **SEC-32** Alertes : pic de refus d'autorisation pour un compte, échecs de connexion répétés, pic d'erreurs d'extraction. Mises en œuvre dans OpenObserve et GlitchTip (OBS-05, OBS-43).
- **SEC-33** Conservation : 12 mois pour le journal de sécurité, 30 jours pour les journaux techniques.

### Cycle de développement

- **SEC-40** Toute modification touchant l'authentification, le moteur de visibilité, la compta, l'extraction ou le temps réel passe par l'agent `security-reviewer` avant fusion (voir `CLAUDE.md`).
- **SEC-41** CI bloquante : analyse statique, audit des dépendances, analyse Trivy des dépendances, de la configuration et des images (`14`, CI-05 à CI-07), détection de secrets, tests de la matrice de visibilité.
- **SEC-42** Test d'intrusion ciblé sur la règle de surprise avant ouverture au public.
- **SEC-43** Procédure de divulgation : fichier `security.txt` et adresse de contact.

## Protection des données (RGPD)

- **RGPD-01** Hébergement et sauvegardes dans l'Union européenne.
- **RGPD-02** Minimisation : pas de date de naissance complète exigée, pas d'adresse postale, pas de numéro de téléphone, pas de coordonnées bancaires.
- **RGPD-03** Registre des sous-traitants : hébergeur, envoi d'e-mails, Anthropic (extraction ; uniquement le contenu public de pages et les photos d'articles, sans donnée d'identification, EXT-33), Google (connexion). L'observabilité (GlitchTip, OpenObserve, collecteur) est auto-hébergée dans l'Union européenne : elle n'ajoute aucun sous-traitant.
- **RGPD-04** Droit d'accès et de portabilité : export complet du compte en JSON, par profil, lancé depuis ce profil (PIN validé) après ré-authentification, jamais depuis l'espace Compte (PIN-08). L'export respecte la règle de surprise (il ne contient pas ce que le profil ne peut pas voir).
- **RGPD-05** Droit à l'effacement : suppression du compte effective sous 30 jours, sauvegardes purgées sous 90 jours. Les écritures de compta impliquant des tiers sont conservées anonymisées (PRO-06).
- **RGPD-06** Mineurs : un profil enfant est créé et géré par le titulaire du compte, qui déclare en avoir l'autorité. Un mineur de moins de 15 ans ne crée pas de compte autonome. S'il a son propre compte, ce compte est **sous la tutelle** d'un compte parent, créé par lui après une déclaration d'autorité parentale horodatée (PRO-15), et n'a pas plus de droits qu'un profil enfant ; seul le tuteur lève la tutelle, et la levée attend la déclaration d'âge du compte (AUTH-08, PRO-16). Un profil enfant n'a pas d'adresse e-mail (PRO-10). Restrictions de PRO-05.
- **RGPD-07** Les photos peuvent contenir des personnes ou des lieux : métadonnées supprimées (EXT-11), jamais publiées au catalogue global (REP-04).
- **RGPD-08** Pas de traceur publicitaire, pas d'analytique tierce. Mesure d'audience sans cookie et auto-hébergée si nécessaire, donc pas de bandeau de consentement.
- **RGPD-09** Durées de conservation : compte inactif depuis 3 ans = avertissement puis suppression ; invitations expirées = 30 jours ; corbeille = 30 jours.
- **RGPD-10** Violation de données : procédure de notification à la CNIL sous 72 heures et aux personnes concernées, avec mention spécifique si des surprises ont pu être révélées.

## Critères d'acceptation

- Un test automatisé parcourt toutes les routes sans session et vérifie le refus, hors liste publique.
- La matrice de visibilité (VIS-33) passe en CI à chaque fusion.
- L'analyse des en-têtes de l'application en production ne signale aucun manque.
- La restauration d'une sauvegarde est faite et chronométrée avant la mise en production.

## Questions ouvertes

1. Âge du consentement numérique retenu : 15 ans (France). À ajuster si l'application est proposée ailleurs.
2. Analyse d'impact (AIPD) : probablement nécessaire à cause des données de mineurs ; à confirmer avec un juriste avant ouverture au public.
3. Niveau de preuve attendu pour « l'autorité parentale » : simple déclaration en v1.
