# 01 — Comptes, profils et authentification

## Objectif

Permettre à une famille de partager un seul compte tout en gardant un espace par personne, avec une authentification solide.

## Compte

- **AUTH-01** Inscription par e-mail + mot de passe, ou par Google (OpenID Connect, flux code + PKCE). L'e-mail doit être vérifié avant toute action sociale (invitation, lien, publication).
- **AUTH-02** Mot de passe : 12 caractères minimum, pas de règle de composition, refus des mots de passe présents dans les fuites connues (vérification k-anonyme), haché en argon2id.
- **AUTH-03** Un compte peut avoir les deux méthodes. Associer Google à un compte existant exige d'être connecté à ce compte ; jamais de fusion automatique sur simple égalité d'e-mail non vérifié.
- **AUTH-04** Session : identifiant opaque en cookie `HttpOnly`, `Secure`, `SameSite=Lax`, stocké côté serveur. Durée glissante de 30 jours, 12 heures pour un compte administrateur. Aucun jeton d'accès dans le stockage du navigateur.
- **AUTH-05** L'utilisateur voit la liste de ses sessions (appareil, dernière activité) et peut les révoquer. Changer de mot de passe ou désactiver le TOTP révoque toutes les autres sessions.
- **AUTH-06** Réinitialisation du mot de passe par lien à usage unique, valable 30 minutes. La réponse est identique que l'e-mail existe ou non.
- **AUTH-07** Limitation des tentatives par compte et par adresse IP, avec délai croissant. Pas de blocage définitif (éviter le déni de service ciblé).

## Double authentification

- **AUTH-10** TOTP (RFC 6238, 6 chiffres, 30 secondes). Activation : affichage du QR code, confirmation par un code valide, puis remise de 10 codes de secours à usage unique, affichés une seule fois.
- **AUTH-11** Le secret TOTP est chiffré au repos avec une clé hors base de données. Un code déjà utilisé est refusé (anti-rejeu).
- **AUTH-12** Le TOTP est demandé à chaque connexion, y compris par Google. Option « faire confiance à cet appareil 30 jours » : l'appareil est enregistré (`trusted_device`, 12) et révocable depuis l'espace Compte.
- **AUTH-13** Le TOTP est **obligatoire** pour les rôles `ADMIN` et `MODERATOR`, recommandé pour les autres (rappel à la création du deuxième profil).
- **AUTH-14** Ré-authentification (mot de passe ou Google, plus TOTP s'il est actif) datant de moins de 10 minutes pour : changer e-mail ou mot de passe, activer ou désactiver le TOTP, réinitialiser ou désactiver le PIN d'un profil (PIN-05), supprimer un profil ou le compte, exporter les données.

## Profils

- **PRO-01** Un compte contient 1 à 10 profils. Le premier est créé à l'inscription.
- **PRO-02** Un profil a : nom affiché, avatar (image ou couleur + initiales), date d'anniversaire facultative (jour et mois, année optionnelle), langue, devise par défaut, marqueur « profil enfant ».
- **PRO-03** Toutes ces informations sont modifiables depuis le profil. L'e-mail et les moyens de connexion se modifient au niveau du compte.
- **PRO-04** Après connexion, l'utilisateur choisit un profil (écran de sélection). S'il n'y en a qu'un, il est sélectionné d'office. Le changement de profil est accessible en un geste depuis l'en-tête.
- **PRO-05** Un profil enfant ne peut pas publier dans le catalogue global, ni créer de lien sans validation d'un profil non-enfant du même compte (le lien reste à l'état `AWAITING_GUARDIAN` tant qu'il n'est pas validé, puis passe à `PENDING`), et son nom n'apparaît jamais hors de son cercle.
- **PRO-06** Supprimer un profil : ses listes personnelles sont supprimées après 30 jours de corbeille ; ses participations et commentaires sont conservés sous l'étiquette « Profil supprimé » pour ne pas fausser les comptes des autres.

## Code PIN

- **PIN-01** Facultatif, 4 à 8 chiffres, propre à chaque profil. Désactivé par défaut.
- **PIN-02** Vérifié côté serveur, haché en argon2id. Le serveur n'accepte aucune action au nom d'un profil protégé tant que la session n'a pas validé son PIN. Ce n'est pas un simple verrou d'interface.
- **PIN-03** 5 erreurs consécutives : attente croissante (1, 5, 15 minutes…). Les autres profils du compte en sont notifiés : tant que le module de notifications n'existe pas (phase 4), la notification prend la forme d'une entrée au journal de sécurité et d'un e-mail au compte.
- **PIN-04** **Créer ou changer son PIN, depuis son profil.** Un profil sans PIN peut s'en donner un depuis ses réglages. Un profil qui a un PIN peut le changer en saisissant **l'ancien PIN** puis le nouveau, sans ré-authentification du compte.
- **PIN-05** **Réinitialiser ou désactiver un PIN, depuis l'espace Compte.** Ces deux actions ne se font pas depuis le profil : uniquement dans l'espace Compte (PIN-08), après ré-authentification (AUTH-14), pour n'importe quel profil du compte. Le profil concerné reçoit une notification visible à sa prochaine entrée (`pin_reset_notice_at`, 12).
- **PIN-06** **Limite assumée.** Quiconque connaît les identifiants du compte peut réinitialiser un PIN (PIN-05). Entre profils d'un même compte, le secret d'un souhait caché repose donc sur le PIN et sur la notification de réinitialisation. L'interface le dit clairement quand un profil sans PIN cache un élément à un autre profil du même compte, et propose d'en créer un.
- **PIN-07** Le PIN est redemandé à chaque changement de profil et après 15 minutes d'inactivité sur un appareil partagé (réglable : jamais, 15 min, à chaque ouverture).
- **PIN-08** **Espace Compte**, sur le modèle des services de streaming : accessible depuis l'écran de sélection des profils, hors de tout profil. Il regroupe e-mail, mot de passe, TOTP, Google, sessions, gestion des profils (créer, supprimer, réinitialiser ou désactiver un PIN) et export des données. Les actions sensibles y demandent la ré-authentification (AUTH-14). Il n'existe pas de profil « gestionnaire » : quiconque sait se connecter au compte y a accès.

## Liens et cercle

- **LNK-01** Un profil invite un autre profil par lien d'invitation, QR code ou e-mail. Le lien est à usage unique et expire après 7 jours.
- **LNK-02** Le lien est mutuel et doit être accepté. Chacun peut le rompre à tout moment ; les accès qui en dépendaient sont retirés immédiatement.
- **LNK-03** Les profils d'un même compte sont dans le cercle les uns des autres sans action.
- **LNK-04** On ne peut pas chercher un profil par nom ou e-mail dans toute la plateforme (pas d'annuaire). On ne trouve que les profils de son cercle et ceux des événements auxquels on participe.
- **LNK-05** Un profil peut en bloquer un autre : plus aucune invitation ni visibilité réciproque.

## Valeurs par défaut

| Réglage | Défaut |
|---|---|
| TOTP | Désactivé (obligatoire pour admin et modérateur) |
| PIN | Désactivé |
| Redemande du PIN | Au changement de profil et après 15 min d'inactivité |
| Langue | Celle du navigateur, sinon français |
| Devise | EUR |

## Critères d'acceptation

- Un compte créé par Google puis doté d'un mot de passe se connecte par les deux moyens au même compte.
- Une requête API portant l'identifiant d'un profil protégé, depuis une session qui n'a pas validé son PIN, reçoit `403`.
- Après changement de mot de passe, les autres sessions sont invalides à la requête suivante.
- Un code TOTP ne peut pas être utilisé deux fois.
- Changer son PIN avec l'ancien PIN réussit sans ré-authentification ; le désactiver depuis le profil est impossible ; le désactiver depuis l'espace Compte exige une ré-authentification de moins de 10 minutes.

## Questions ouvertes

1. Passkeys (WebAuthn) en plus du TOTP : voir `15-suggestions.md`.
2. Âge minimal pour un compte autonome et consentement parental : à caler avec `09-securite-rgpd.md`.
