# 01 — Comptes, profils et authentification

## Objectif

Permettre à une famille de partager un seul compte tout en gardant un espace par personne, avec une authentification solide.

## Compte

- **AUTH-01** Inscription par e-mail + mot de passe, ou par Google (OpenID Connect, flux code + PKCE). L'e-mail doit être vérifié avant toute action sociale (invitation, lien, publication).
- **AUTH-02** Mot de passe : 12 caractères minimum, 256 au plus (borne contre un hachage coûteux), pas de règle de composition, refus des mots de passe présents dans les fuites connues (vérification k-anonyme : seuls les 5 premiers caractères du SHA-1 quittent le serveur, réponse avec bourrage), haché en argon2id (19 Mio, 2 passes, 1 fil). Si le service de vérification ne répond pas (3 secondes), le mot de passe est accepté sans vérification et la panne est comptée : une indisponibilité d'un tiers ne bloque ni l'inscription ni la réinitialisation.
- **AUTH-03** Un compte peut avoir les deux méthodes. Associer Google à un compte existant exige d'être connecté à ce compte ; jamais de fusion automatique sur simple égalité d'e-mail non vérifié.
- **AUTH-04** Session : identifiant opaque en cookie `HttpOnly`, `Secure`, `SameSite=Lax`, stocké côté serveur. Durée glissante de 30 jours, 12 heures pour un compte administrateur ou modérateur. Aucun jeton d'accès dans le stockage du navigateur. Forme du jeton, stockage, rotation, révocation et CSRF : ADR 0013.
- **AUTH-05** L'utilisateur voit la liste de ses sessions (appareil, dernière activité) et peut les révoquer. Changer de mot de passe, activer ou désactiver le TOTP révoque toutes les autres sessions (la session de l'appelant est remplacée par une neuve). Un changement de rôle ou la suspension du compte révoque toutes ses sessions. Durée absolue d'une session : 90 jours, 24 heures pour un compte administrateur ou modérateur (ADR 0013).
- **AUTH-06** Réinitialisation du mot de passe par lien à usage unique, valable 30 minutes. La réponse est identique que l'e-mail existe ou non. Une réinitialisation réussie révoque **toutes** les sessions, pré-authentifications et appareils de confiance du compte, et marque l'e-mail comme vérifié (le lien le prouve). Le jeton passe dans le fragment du lien puis dans le corps d'une requête, jamais dans une chaîne de requête (ADR 0013).
- **AUTH-07** Limitation des tentatives par compte et par adresse IP, avec délai croissant. Pas de blocage définitif (éviter le déni de service ciblé). Les échecs du second facteur sont comptés par compte : recommencer le premier facteur ne remet pas le compteur à zéro (ADR 0013). Leur délai est plafonné à une heure (au lieu de 15 minutes), et l'adresse du compte est avertie, une fois par fenêtre de 24 heures, dès qu'un code faux saisi à la connexion ou à la ré-authentification porte le compteur au seuil : des codes faux après un mot de passe juste disent qu'un tiers connaît ce mot de passe. Les codes faux de l'activation comptent sur le seuil sans déclencher l'avertissement eux-mêmes. Une réinitialisation du mot de passe remet ce compteur à zéro (le lien reçu par e-mail prouve plus qu'un code).
- **AUTH-08** **Âge.** L'inscription exige de déclarer avoir 15 ans ou plus (case à cocher, non précochée). La déclaration est horodatée sur le compte (`age_attested_at`, 12). Aucune date de naissance n'est demandée au compte (RGPD-02). Une personne de moins de 15 ans a un profil enfant dans le compte d'un parent (RGPD-06).
- **AUTH-09** **Mode d'inscription**, réglé par l'environnement : `OPEN` (inscription libre) ou `INVITE_ONLY` (inscription possible seulement avec un jeton d'invitation valide, LNK-01, y compris par Google ; l'invitation n'est consommée qu'à la vérification de l'e-mail, pour que son état ne révèle rien ; si elle est épuisée à ce moment, la vérification est refusée par un message neutre et le compte est supprimé). Dans les deux modes, la réponse à une inscription ne révèle pas si l'e-mail a déjà un compte : même réponse, même délai ; le titulaire existant reçoit un e-mail l'avertissant de la tentative. La valeur retenue au lancement reste à décider (`11`, Q2).
- **AUTH-15** **Compte non vérifié.** Tant que son e-mail n'est pas vérifié, un compte ne peut **rien créer** (ni profil supplémentaire, ni liste, ni fiche article, ni action sociale, AUTH-01), ni activer le TOTP, ni être associé à Google. Il **ne peut pas se connecter par mot de passe** : la connexion répond le même refus qu'un mot de passe faux, pour qu'une inscription suivie d'une connexion ne dise pas si l'adresse avait déjà un compte. Le lien de vérification **n'ouvre pas de session** : il prouve la boîte, pas l'inscription. On se connecte ensuite avec son mot de passe ; qui a reçu le lien d'une inscription faite par un autre ne le connaît pas et passe par la réinitialisation, qui évince l'auteur (AUTH-06). Il n'a donc aucun contenu à perdre. Il est supprimé s'il n'est pas vérifié sous 7 jours. Une inscription ou une connexion par Google avec un e-mail vérifié par Google, sur un compte local **non vérifié** de même adresse, **remplace** ce compte (supprimé avec ses sessions) au lieu de s'y rattacher : celui qui a inscrit l'adresse d'un autre n'en garde rien.
- **AUTH-16** **Changement d'e-mail** (`PUT /auth/email`, après ré-authentification, AUTH-14) : effectif seulement après confirmation par un lien envoyé à la nouvelle adresse. La réponse est identique que la nouvelle adresse soit libre ou déjà prise ; si elle est prise, son titulaire reçoit un avertissement à la place du lien. L'ancienne adresse est prévenue, avec un lien d'annulation valable 7 jours qui rétablit l'ancienne adresse et révoque toutes les sessions : un proche qui connaît le mot de passe ne détourne pas le compte en silence. L'avertissement part **avant** le lien de confirmation ; s'il ne peut pas partir (quota d'envoi de l'ancienne adresse atteint), la demande s'arrête là. Une nouvelle demande ne désarme pas un lien d'annulation déjà reçu ; à l'inverse, une annulation désarme tous les liens d'annulation émis **après** le sien, ainsi que les liens de vérification, de confirmation et de réinitialisation encore ouverts. L'annulation est **tout ou rien** : si l'ancienne adresse n'est plus libre, rien n'est écrit et le lien reste utilisable. Quand elle aboutit, elle **efface le mot de passe** (celui qui a fait la demande le connaît) et envoie un lien de réinitialisation à l'adresse rétablie. Tant qu'un lien d'annulation ouvert peut la rétablir, l'ancienne adresse reste **réservée** au compte : une inscription ou un changement d'e-mail vers elle depuis un autre compte est traité comme pour une adresse prise. Après un changement de mot de passe, l'adresse du compte reçoit un avis.

## Double authentification

- **AUTH-10** TOTP (RFC 6238, SHA-1, 6 chiffres, 30 secondes). Activation : le serveur tire un secret de 160 bits et le renvoie une seule fois avec son URI `otpauth://`, que le client affiche en QR code sans passer par un service tiers ; confirmation par un code valide, puis remise de 10 codes de secours à usage unique, affichés une seule fois. Un code de secours a 80 bits (16 caractères base32 de Crockford, affichés `XXXX-XXXX-XXXX-XXXX` ; tirets, espaces, casse et lettres ambiguës tolérés à la saisie) ; il remplace un code TOTP à la connexion comme à la ré-authentification. En régénérer invalide tous les précédents. L'activation, comme la désactivation, déconnecte toutes les autres sessions (AUTH-05) : une session ouverte par un tiers qui connaissait le mot de passe ne lui survit pas. L'adresse du compte est avertie de l'activation, de la désactivation et de chaque usage d'un code de secours.
- **AUTH-11** Le secret TOTP est chiffré au repos avec une clé hors base de données (SEC-22). Un pas de temps d'écart est toléré de part et d'autre. Un code déjà utilisé est refusé (anti-rejeu) : le dernier pas accepté est noté par une écriture conditionnelle, et un code de ce pas ou d'un pas antérieur est refusé, même en concurrence.
- **AUTH-12** Le TOTP est demandé à chaque connexion, y compris par Google. Après le mot de passe, une **pré-authentification** de 5 minutes attend le code (ADR 0013) ; un code faux ne l'efface pas, une réinitialisation du mot de passe ou une désactivation du TOTP l'invalide. Option « faire confiance à cet appareil 30 jours » : l'appareil est enregistré (`trusted_device`, 12) et dispense du code sur ce navigateur pour ce compte seulement ; il est révocable depuis l'espace Compte, et sa révocation révoque aussi les sessions ouvertes grâce à lui. Une réinitialisation du mot de passe (AUTH-06) ou une désactivation du TOTP révoque tous les appareils de confiance du compte.
- **AUTH-13** Le TOTP est **obligatoire** pour les rôles `ADMIN` et `MODERATOR`, recommandé pour les autres (rappel à la création du deuxième profil). Un compte de ces rôles sans TOTP actif ne peut pas se connecter (`403 TOTP_ENROLLMENT_REQUIRED`) : le TOTP s'active **avant** l'attribution du rôle. Il ne peut pas le désactiver, et un appareil de confiance ne le dispense jamais du code.
- **AUTH-14** Ré-authentification (mot de passe ou Google, plus un code TOTP ou de secours s'il est actif) datant de moins de 10 minutes pour : changer e-mail ou mot de passe, activer ou désactiver le TOTP, régénérer les codes de secours, réinitialiser ou désactiver le PIN d'un profil (PIN-05), supprimer un profil ou le compte, exporter les données. Avec le TOTP, un code faux à la ré-authentification compte aussi sur le compteur du second facteur ; un mot de passe faux, non (aucun code n'est alors évalué). La ré-authentification est effacée au changement de profil et au verrouillage : elle ne profite pas à la personne qui reprend l'appareil (ADR 0013).

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
- **PIN-05** **Réinitialiser ou désactiver un PIN, depuis l'espace Compte.** Ces deux actions ne se font pas depuis le profil : uniquement dans l'espace Compte (PIN-08), après une ré-authentification de **moins de 2 minutes** (AUTH-14, ADR 0013), pour n'importe quel profil du compte. Le profil concerné reçoit une notification visible à sa prochaine entrée (`pin_reset_notice_at`, 12).
- **PIN-06** **Limite assumée.** Quiconque connaît les identifiants du compte peut réinitialiser un PIN (PIN-05). Entre profils d'un même compte, le secret d'un souhait caché repose donc sur le PIN et sur la notification de réinitialisation. L'interface le dit clairement quand un profil sans PIN cache un élément à un autre profil du même compte, et propose d'en créer un.
- **PIN-07** Le PIN est redemandé à chaque changement de profil et après 15 minutes d'inactivité sur un appareil partagé (réglable par le profil, `pin_relock` : jamais, 15 min, à chaque ouverture). Le déverrouillage n'est tenu que dans le cache de session ; s'il est perdu, le profil est reverrouillé (ADR 0013).
- **PIN-08** **Espace Compte**, sur le modèle des services de streaming : accessible depuis l'écran de sélection des profils, hors de tout profil. Il regroupe e-mail, mot de passe, TOTP, Google, sessions, gestion des profils (créer, supprimer, réinitialiser ou désactiver un PIN). Les actions sensibles y demandent la ré-authentification (AUTH-14). Il n'existe pas de profil « gestionnaire » : quiconque sait se connecter au compte y a accès. **Comme il échappe au PIN, l'espace Compte ne montre que des métadonnées** : e-mail, moyens de connexion, sessions, appareils, et pour chaque profil son nom, son avatar, la présence d'un PIN et le marqueur enfant ; jamais une liste, un élément ni une donnée d'offreur. L'export des données (RGPD-04) se lance donc depuis chaque profil, PIN validé, et non depuis l'espace Compte (ADR 0013).

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

**Durée des jetons envoyés par e-mail** (`account_token`, 12) :

| Usage | Durée |
|---|---|
| Vérification de l'e-mail (`EMAIL_VERIFY`) | 7 jours (le compte non vérifié est supprimé au même terme, AUTH-15) |
| Confirmation d'un changement d'e-mail (`EMAIL_CHANGE`) | 24 heures |
| Annulation d'un changement d'e-mail (`EMAIL_CHANGE_CANCEL`) | 7 jours (AUTH-16) |
| Réinitialisation du mot de passe (`PASSWORD_RESET`) | 30 minutes (AUTH-06) |

**Second facteur** :

| Élément | Durée |
|---|---|
| Pré-authentification (`__Host-lh_pending`, Redis seul) | 5 minutes (ADR 0013) |
| Appareil de confiance (`__Host-lh_device`, `trusted_device`) | 30 jours (AUTH-12) |

**Limitation** (AUTH-07, ADR 0013). Au-delà du seuil, délai croissant (1 s, 2 s, 4 s… plafonné à 15 minutes, une heure pour le second facteur), jamais de blocage définitif :

| Portée | Clé | Compte | Seuil | Fenêtre | Remis à zéro par un succès |
|---|---|---|---|---|---|
| Connexion, couple | e-mail, IP | échecs | 5 | 24 h | oui |
| Connexion, compte | e-mail | échecs | 20 (50 depuis un appareil de confiance) | 1 h | non |
| Connexion, IP | IP | échecs | 50 | 1 h | non |
| Second facteur (connexion, activation du TOTP, ré-authentification avec TOTP) | compte | échecs | 5 | 24 h | oui (succès du second facteur, ou réinitialisation du mot de passe) |
| Ré-authentification | compte | échecs | 5 | 24 h | oui |
| Inscription | IP | demandes | 10 | 1 h | non |
| Réinitialisation | IP | demandes | 10 | 1 h | non |
| Envoi d'e-mail | adresse destinataire, sorte d'e-mail | envois | 3 | 24 h | non |

Le compteur des envois par destinataire ne produit jamais de `429` : au-delà, l'e-mail n'est simplement pas envoyé et la réponse reste la même, pour qu'elle ne dise rien de l'existence d'un compte. Il est tenu **par sorte d'e-mail** (vérification, réinitialisation, avertissement de changement d'e-mail…) : épuiser l'une ne bloque pas les autres. Au-delà du seuil, le délai croissant s'applique : un tiers qui multiplie les demandes de réinitialisation fait lui-même partir les liens vers la boîte du titulaire, il ne l'en prive pas. Les clés « e-mail » valent pour toute adresse, inscrite ou non.

## Critères d'acceptation

- Un compte créé par Google puis doté d'un mot de passe se connecte par les deux moyens au même compte.
- Une requête API faite au nom d'un profil protégé, depuis une session qui n'a pas validé son PIN, reçoit `423` (`PROFILE_LOCKED`). Une route de profil n'agit que sur le profil actif : un autre profil, même du même compte, ne s'atteint que par l'espace Compte.
- Le déverrouillage d'un profil expire après 15 minutes sans action de l'utilisateur, même si l'application reste ouverte et reçoit des mises à jour.
- Un jeton de session révoqué, ou remplacé par une ré-authentification, est refusé à la requête suivante, même si le serveur s'est arrêté au milieu de la révocation.
- Une réinitialisation de mot de passe révoque toutes les sessions, y compris celle d'un tiers qui aurait inscrit l'adresse avant son titulaire.
- Aucune réponse de l'espace Compte ne contient de donnée d'une liste ni d'offreur (test de forme).
- Après changement de mot de passe, les autres sessions sont invalides à la requête suivante.
- Un code TOTP ne peut pas être utilisé deux fois, ni un code d'un pas antérieur au dernier accepté. Un code de secours ne sert qu'une fois.
- Révoquer un appareil de confiance déconnecte les sessions ouvertes grâce à lui ; il ne dispense plus du code.
- Désactiver le TOTP révoque les autres sessions, les codes de secours et les appareils de confiance. L'activer révoque aussi les autres sessions.
- Quand un code faux saisi à la connexion ou à la ré-authentification porte le compteur du second facteur au seuil (5), l'adresse du compte reçoit un avertissement, une fois par fenêtre de 24 heures.
- Après 5 échecs du second facteur, recommencer la connexion par mot de passe, même depuis une autre adresse IP, ne donne pas d'essai supplémentaire sans attendre le délai.
- Une inscription avec un e-mail déjà inscrit reçoit la même réponse, dans le même délai, qu'une inscription nouvelle ; aucun compte n'est créé. Une connexion qui suit ne le révèle pas non plus (AUTH-15).
- Un proche qui a changé l'adresse du compte, puis enchaîné d'autres changements, ne garde pas le compte quand le titulaire suit son lien d'annulation (AUTH-16).
- En mode `INVITE_ONLY`, une inscription sans jeton d'invitation valide est refusée.
- Changer son PIN avec l'ancien PIN réussit sans ré-authentification ; le désactiver depuis le profil est impossible ; le désactiver depuis l'espace Compte exige une ré-authentification de moins de 2 minutes.

## Questions ouvertes

1. Passkeys (WebAuthn) en plus du TOTP : voir `15-suggestions.md`.
2. ~~Âge minimal pour un compte autonome et consentement parental~~ : décidé le 2026-11-13, AUTH-08.
