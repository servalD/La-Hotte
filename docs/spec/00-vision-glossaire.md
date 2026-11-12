# 00 — Vision et glossaire

## Vision

Une application pour dire ce qu'on aimerait recevoir, organiser ce qu'on offre, et se répartir les frais, sans jamais gâcher une surprise.

Trois promesses :

1. **Ajouter un souhait prend dix secondes** : on colle un lien ou on prend une photo, la fiche se remplit seule.
2. **La surprise est garantie par construction** : la personne qui reçoit ne peut pas voir qui offre quoi, même par erreur.
3. **Personne n'avance de l'argent dans le flou** : chaque cadeau commun a un acheteur, des parts, et un état de remboursement.

## Périmètre de la v1

Inclus : comptes et profils, fiches article avec extraction automatique, wishlists, giftlists, événements, visibilité fine, répertoire d'articles, commentaires, notifications temps réel, compta des participations, mode hors ligne, installation sur mobile, administration.

Exclus : paiement en ligne, cagnotte, achat depuis l'application, application native distribuée par les stores, messagerie privée libre.

## Personas

| Persona | Besoin principal |
|---|---|
| **Le parent organisateur** | Gère les profils des enfants sur un seul compte, crée l'événement de Noël, suit son budget. |
| **L'enfant ou l'ado** | Ajoute ses souhaits depuis le téléphone familial, sans pouvoir modifier ceux des autres. |
| **Le proche qui offre** | Voit les souhaits, réserve, participe à un cadeau commun, sait ce qu'il doit à qui. |
| **Le couple** | Tient une liste commune (naissance, mariage, emménagement). |
| **L'administrateur** | Modère le catalogue global, traite les signalements, n'a pas accès aux contenus privés. |

## Glossaire

Ces termes sont utilisés tels quels dans toute la spec, le code et l'interface. Ne jamais employer « compte » pour « profil ».

| Terme | Définition |
|---|---|
| **Compte** | Identité de connexion : une adresse e-mail, un moyen d'authentification (mot de passe ou Google), éventuellement le TOTP. Un compte porte un rôle plateforme. |
| **Profil** | Une personne. Un compte contient un ou plusieurs profils. Tout ce qui est social (listes, invitations, visibilité, compta) vise des profils, jamais des comptes. |
| **Profil actif** | Le profil sous lequel on agit dans la session courante. |
| **Code PIN** | Code optionnel protégeant l'entrée dans un profil. |
| **Lien** | Relation acceptée entre deux profils de comptes différents. |
| **Cercle** | Pour un profil : les autres profils de son compte et les profils avec lesquels il a un lien. |
| **Fiche article** | Description d'un produit : titre, image, description, prix unitaire, devise, vendeur, URL d'origine. Réutilisable dans plusieurs listes. |
| **Élément** | Ligne d'une liste, qui référence une fiche article et porte une quantité, une visibilité et un état. |
| **Souhait** | Élément d'une wishlist. |
| **Cadeau** | Élément d'une giftlist. |
| **Wishlist** | Liste de souhaits tenue par son ou ses destinataires. |
| **Giftlist** | Liste de cadeaux tenue par des offreurs pour un ou plusieurs destinataires, secrète par défaut. |
| **Destinataire** | Profil qui recevra les éléments d'une liste. |
| **Offreur** | Profil qui voit une liste sans en être destinataire. |
| **Événement** | Occasion datée (Noël, anniversaire) qui réunit des profils invités et leurs listes. |
| **Réservation** | Engagement d'un offreur à offrir tout ou partie d'un élément. |
| **Participation** | Part financière d'un offreur sur un élément : montant fixe, pourcentage ou totalité. |
| **Acheteur** | Profil chargé d'acheter un élément et de pointer les remboursements. |
| **Répertoire** | Ensemble des fiches article qu'un profil a choisi de partager, à son cercle ou au catalogue global. |
| **Catalogue global** | Partie du répertoire visible de tous les utilisateurs inscrits, anonymisée et modérée. |
| **Règle de visibilité** | `TOUS`, `SEULEMENT (profils)` ou `TOUS SAUF (profils)`, appliquée à un élément. |

## Principes directeurs

1. **Simple par défaut, précis sur demande.** Chaque écran fonctionne sans toucher à un réglage. Les options avancées sont repliées.
2. **Le serveur décide de ce qui est visible.** Une donnée qu'un profil n'a pas le droit de voir n'est jamais envoyée à son appareil.
3. **Privé par défaut.** Rien n'est publié dans le répertoire sans action explicite.
4. **Toute décision par défaut est écrite.** Chaque fichier de spec liste ses valeurs par défaut et ses questions ouvertes.

## Organisation de la spec

Les fichiers `01` à `11` décrivent le produit, `12` à `14` la technique, `15` les suggestions, `99` la traçabilité avec la demande d'origine. Les règles sont numérotées par préfixe (`AUTH-03`, `VIS-07`…) pour être citées dans le code, les tests et les revues.
