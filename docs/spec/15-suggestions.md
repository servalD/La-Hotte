# 15 — Suggestions de fonctionnalités

Idées qui ne figuraient pas dans la demande d'origine. Aucune n'est engagée : cochez celles à intégrer, elles seront alors spécifiées dans le fichier concerné et placées dans la roadmap.

## Déjà intégrées à la spec parce qu'elles sont nécessaires

Sans elles, le produit décrit ne tient pas debout. À retirer explicitement si vous n'en voulez pas.

| Fonction                                         | Où               | Pourquoi                                                                       |
| ------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------ |
| Règle de surprise et double fil de commentaires  | VIS-20, COM-01   | Sans elle, un destinataire lit « je le prends » sous son propre souhait.       |
| Contrôle anti-doublon à la réservation           | CPT-03           | Deux personnes ne doivent pas acheter le même cadeau.                          |
| Ajout par photo pour les articles en magasin     | EXT-10           | Répond à « vendeur en ligne ou pas ».                                          |
| Partage depuis le téléphone vers l'application   | PWA-02           | Chemin d'ajout le plus naturel sur mobile.                                     |
| Suggestion d'un offreur sur la liste d'un proche | WSH-04           | Version légère de la giftlist.                                                 |
| « Je l'ai déjà » / « je n'en veux plus »         | LST-15           | Évite d'offrir un souhait périmé.                                              |
| Priorité d'un souhait                            | ART-12           | Aide les offreurs à choisir.                                                   |
| Notifications neutres sur appareil partagé       | NOT-06           | Une notification push ne doit pas révéler un cadeau sur le téléphone familial. |
| Export et suppression des données                | RGPD-04, RGPD-05 | Obligation légale.                                                             |

## Proposées

| #   | Fonction                                                                                                     | Intérêt                                                                    | Coût                               | Avis                                                 |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------- |
| 1   | **Groupes nommés** (« grands-parents », « collègues ») utilisables dans « Qui voit ça ? » et les invitations | Fort dès qu'on dépasse dix proches                                         | Faible                             | À faire tôt                                          |
| 2   | **Tirage au sort** (Secret Santa) dans un événement, avec exclusions (couples) et budget                     | Fort à Noël, très demandé                                                  | Moyen                              | À faire                                              |
| 3   | **Passkeys** (WebAuthn) en connexion et en second facteur                                                    | Plus sûr et plus simple que le TOTP, résiste à l'hameçonnage               | Moyen                              | À faire après le TOTP                                |
| 5   | **Rappels d'anniversaire** des profils du cercle, avec lien vers leur liste                                  | Fait revenir dans l'application au bon moment                              | Faible                             | À faire                                              |
| 6   | **Lien invité en lecture seule** : consulter une liste et réserver sans créer de compte                      | Lève le principal frein à l'adoption (la tante qui ne veut pas s'inscrire) | Moyen, sensible côté sécurité      | À étudier                                            |
| 7   | **Suivi de prix** : relevé périodique et alerte de baisse pour les offreurs                                  | Utile                                                                      | Moyen, coût d'extraction récurrent | Plus tard                                            |
| 8   | **Alternatives** : plusieurs liens marchands pour un même souhait                                            | Utile                                                                      | Faible                             | Plus tard                                            |
| 9   | **Idées en vrac** : noter une idée de cadeau pour quelqu'un sans créer de giftlist                           | Usage personnel fréquent                                                   | Faible                             | À faire (c'est une giftlist privée à un seul membre) |
| 10  | **Historique des cadeaux** : ce que j'ai offert à chacun, année après année                                  | Évite d'offrir deux fois la même chose                                     | Faible, les données existent       | À faire                                              |
| 11  | **Remerciements** : mot ou photo envoyé aux offreurs après réception                                         | Agréable                                                                   | Faible                             | Plus tard                                            |
| 12  | **Moyens de règlement** : lien de paiement de l'acheteur affiché aux participants                            | Accélère les remboursements                                                | Faible, donnée sensible            | À décider (question ouverte de `07`)                 |
| 13  | **Simplification des dettes** à plusieurs sur un événement                                                   | Moins de virements                                                         | Moyen, déroutant                   | Plus tard                                            |
| 14  | **Import** d'une liste depuis un autre service ou un fichier                                                 | Facilite la migration                                                      | Moyen                              | Plus tard                                            |
| 15  | **Détection de doublons** dans une liste (même URL normalisée)                                               | Petit confort                                                              | Faible                             | À faire                                              |
| 16  | **Tailles et préférences du profil** (pointures, couleurs, allergies) visibles du cercle                     | Évite la question « quelle taille ? »                                      | Faible                             | À faire                                              |
| 17  | **Calendrier** : export `.ics` des événements                                                                | Confort                                                                    | Faible                             | Plus tard                                            |

## Écartées pour la v1

| Fonction                                   | Raison                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Paiement et cagnotte intégrés              | Réglementation des services de paiement, risque et coût disproportionnés                          |
| Application native sur les stores          | La PWA couvre le besoin ; à revoir si le partage sur iOS se révèle trop limitant                  |
| Liens d'affiliation                        | Conflit avec la confiance et la neutralité ; décision de modèle économique                        |
| Recommandations de cadeaux par IA          | Demande d'exploiter les goûts des utilisateurs ; hors de l'esprit « privé par défaut »            |
| Messagerie privée libre                    | Les fils par élément suffisent ; une messagerie ajoute une charge de modération                   |
| « Montrer que c'est pris » au destinataire | Décision du 2026-11-12 : le destinataire ne doit jamais savoir qu'un souhait est réservé (LST-17) |
