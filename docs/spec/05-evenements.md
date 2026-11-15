# 05 — Événements

## Objectif

Réunir des profils autour d'une date, et faire en sorte que chacun arrive avec une liste prête en moins d'une minute.

## Création

- **EVT-01** Un événement a : titre, date (obligatoire), lieu et description facultatifs, type (`Noël`, `anniversaire`, `naissance`, `mariage`, `autre`), un ou plusieurs organisateurs, un budget conseillé par cadeau facultatif.
- **EVT-02** Deux formes :
  - **Échange** (Noël) : chaque participant est à la fois destinataire et offreur. Chacun apporte sa wishlist.
  - **À l'honneur** (anniversaire) : un ou plusieurs destinataires désignés ; les autres participants sont offreurs et n'ont pas à fournir de liste.
- **EVT-03** Le créateur est organisateur. Il peut nommer d'autres organisateurs, qui ont les mêmes droits sauf supprimer l'événement.
- **EVT-04** Un événement « à l'honneur » peut être **surprise** : le ou les destinataires ne sont pas invités et n'en voient aucune trace (mêmes garanties que GFT-07). Les offreurs travaillent alors sur une giftlist.

## Invitations

- **EVT-10** L'organisateur invite des profils de son cercle, ou partage un lien ou QR code d'invitation. Le lien est révocable, limité en nombre d'usages et expire à la date de l'événement.
- **EVT-11** Un invité hors du cercle de l'organisateur doit avoir un compte pour répondre. Rejoindre un événement ne crée **pas** de lien : les participants se voient dans le cadre de l'événement seulement.
- **EVT-12** Inviter un compte à plusieurs profils : l'invitation vise des profils précis. Avec un lien générique, la personne choisit quels profils de son compte participent.
- **EVT-13** Réponses : `Participe`, `Peut-être`, `Ne participe pas`. Modifiable jusqu'à la date. Une invitation sans réponse reçoit un rappel à J-14 et J-3 (réglable par l'organisateur).
- **EVT-14** Seuls les profils ayant répondu `Participe` ou `Peut-être` font partie de l'audience des listes de l'événement.

## Répondre et composer sa liste

- **EVT-20** En répondant `Participe` à un événement d'échange, le profil arrive sur un assistant en trois étapes, chacune facultative :
  1. **Reprendre mes souhaits non obtenus** : souhaits de ses listes passées qu'il n'a pas cochés « reçu » (LST-14), présélectionnés, à décocher.
  2. **Piocher des idées** : recherche dans sa liste « Mes envies », dans les listes des autres auxquelles il a accès, dans le répertoire de son cercle et le catalogue global.
  3. **Ajouter du neuf** : lien, photo ou saisie.
- **EVT-21** Reprendre un souhait non obtenu le **déplace par référence** : le même souhait apparaît dans la nouvelle liste et l'ancienne liste garde une trace « reporté vers… ». Ses commentaires publics suivent, son fil des offreurs repart de zéro.
- **EVT-22** La liste des « non obtenus » est calculée par le serveur **sans rien révéler** : elle contient tous les souhaits passés du profil qu'il n'a pas cochés « reçu » ni retirés, **quel que soit leur état réel**. Un souhait secrètement réservé ou acheté y figure comme les autres : l'en retirer trahirait l'achat par son absence.
- **EVT-26** Si le destinataire reprend un souhait réellement `RÉSERVÉ` ou `ACHETÉ` :
  - côté offreurs, l'élément garde son état et ses participations, avec la mention « déjà acheté pour _Noël 2025_ » ou « déjà réservé pour… » ;
  - les participants de l'ancien élément sont notifiés (« Léa a remis ce souhait dans sa liste pour _Anniversaire 2026_ ») et décident : prévenir Léa dans le fil public, ou laisser faire ;
  - côté destinataire, rien ne change : l'élément est neutre comme les autres.
- **EVT-23** Piocher dans la liste d'un autre crée une copie (ART-04). L'autre n'en est pas notifié.
- **EVT-24** Le profil peut aussi rattacher une liste existante à l'événement plutôt que d'en créer une.
- **EVT-25** Sortie de l'assistant possible à tout moment ; la liste existe dès la première étape et se complète plus tard.

## Vie de l'événement

- **EVT-30** Page de l'événement : participants et leur réponse, listes de chacun, avancement global côté offreurs (« 12 souhaits sur 30 ont un offreur »), jamais montré aux destinataires pour leurs propres listes.
- **EVT-31** Vue « qui n'a encore rien » pour les offreurs : destinataires sans aucun élément réservé, pour éviter les oubliés.
- **EVT-32** Le lendemain de l'événement : invitation des destinataires à cocher ce qu'ils ont reçu (liste de tous leurs souhaits de l'événement, sans indication de ce qui a été acheté), et des offreurs à solder leurs comptes (`07-compta.md`). Cocher « reçu » est ce qui empêche un souhait d'être reproposé plus tard (LST-14).
- **EVT-33** 30 jours après la date, l'événement passe en `TERMINÉ` : lecture seule, sauf confirmations de réception et pointage des remboursements.
- **EVT-34** Annulation par un organisateur : tous les participants sont notifiés ; les réservations sont conservées et marquées « événement annulé » pour que les achats déjà faits restent traçables.
- **EVT-35** Événement récurrent (anniversaire, Noël) : proposition de recréer l'événement l'année suivante avec les mêmes invités.

## Valeurs par défaut

| Réglage                          | Défaut                                                                   |
| -------------------------------- | ------------------------------------------------------------------------ |
| Forme                            | `Échange` pour Noël, `À l'honneur` pour anniversaire, naissance, mariage |
| Surprise                         | Non                                                                      |
| Rappels                          | J-14 et J-3                                                              |
| Audience des listes              | Participants de l'événement                                              |
| Souhaits non obtenus à l'étape 1 | Tous présélectionnés                                                     |

## Critères d'acceptation

- Un profil qui répond `Participe` obtient une liste rattachée à l'événement en trois gestes au plus.
- Le contenu de l'étape 1 est identique, pour un destinataire, que ses souhaits passés soient ouverts, réservés ou achetés (aucune fuite par différence) ; seuls ses souhaits cochés « reçu » en sont absents.
- Un participant qui passe à `Ne participe pas` perd l'accès aux listes des autres à la requête suivante ; ses réservations en cours déclenchent une alerte aux organisateurs.
- Le destinataire d'un événement surprise ne reçoit ni notification, ni e-mail, ni entrée de calendrier.

## Questions ouvertes

1. Tirage au sort (« Secret Santa ») : voir `15-suggestions.md`.
2. Un invité sans compte peut-il consulter par lien en lecture seule ? Défaut : non, compte requis.
