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
- **EVT-05** **Date et fuseau.** La date est un jour, sans heure, lu dans le fuseau du profil créateur, gardé sur l'événement. « Avant » et « après la date » s'entendent dans ce fuseau ; « le lendemain » est le jour suivant. Une date passée est refusée à la création et à la modification. Titre de 1 à 120 caractères, lieu de 200 au plus, description de 2 000 au plus ; budget conseillé en unités mineures, dans la devise du créateur.
- **EVT-06** **Organisateurs.** Un organisateur nomme organisateur un autre participant (jamais un honoré). Seul le créateur retire ce rôle ; le créateur reste organisateur, quelle que soit sa réponse. Organiser est une ligne de participant comme une autre : il voit l'événement par elle.
- **EVT-07** **Honorés.** Un événement « à l'honneur » a un ou plusieurs honorés, choisis parmi le cercle du créateur et les profils de son compte. Hors surprise, l'honoré est participant (marqué honoré) et répond comme les autres ; le créateur peut être son propre honoré. En surprise, les honorés sont gardés à part, **n'ont jamais de ligne de participant** (garanti en base) et ne peuvent être ni invités, ni organisateurs ; le créateur ne peut pas être honoré de sa propre surprise. Un événement d'échange n'a pas d'honoré. On ajoute un honoré, on ne le retire pas (comme un destinataire, LST-07).
- **EVT-08** **Qui voit l'événement.** Un profil voit un événement s'il en a une ligne de participant, quelle que soit sa réponse (`Ne participe pas` compris : il peut se raviser). Sinon l'événement répond `404`, comme un identifiant inconnu, à toutes les routes ; c'est le cas de l'honoré d'une surprise. Les participants voient de chacun le nom, l'avatar, le rôle, la réponse et, hors surprise, la marque d'honoré ; les offreurs d'une surprise voient ses honorés. Se voir dans un événement ne crée pas de lien (EVT-11).
- **EVT-09** La forme (échange ou à l'honneur) et la surprise se fixent à la création. Passer une surprise en événement ordinaire la révélerait ; l'inverse ne cacherait plus rien.

## Invitations

- **EVT-10** L'organisateur invite des profils de son cercle, ou partage un lien ou QR code d'invitation. Le lien est révocable, limité en nombre d'usages et expire à la date de l'événement.
- **EVT-11** Un invité hors du cercle de l'organisateur doit avoir un compte pour répondre. Rejoindre un événement ne crée **pas** de lien : les participants se voient dans le cadre de l'événement seulement.
- **EVT-12** Inviter un compte à plusieurs profils : l'invitation vise des profils précis. Avec un lien générique, la personne choisit quels profils de son compte participent.
- **EVT-13** Réponses : `Participe`, `Peut-être`, `Ne participe pas`. Modifiable jusqu'à la date. Une invitation sans réponse reçoit un rappel à J-14 et J-3 (réglable par l'organisateur).
- **EVT-14** Seuls les profils ayant répondu `Participe` ou `Peut-être` font partie de l'audience des listes de l'événement.
- **EVT-15** **Invitation directe.** Un organisateur invite des profils de son propre cercle (LNK-09) : chacun reçoit une ligne de participant `En attente`. Le compte de chaque profil invité reçoit un e-mail **neutre** : « un profil de votre compte a reçu une invitation », sans titre, date, lieu ni nom, puisqu'un compte peut abriter l'honoré d'une surprise (GFT-08). Inviter un honoré de surprise est refusé (`422 EVENT_HONOREE_CANNOT_PARTICIPATE`).
- **EVT-16** **Lien d'invitation.** Jeton de 128 bits, haché en base ; 20 usages par défaut (1 à 100) ; expire à la fin de la date de l'événement dans son fuseau ; révocable par un organisateur ; un profil enfant n'en crée pas. Ouvrir le lien exige une session, et c'est **le profil actif** qui rejoint (`En attente`) : pour inscrire un autre profil du compte, on change de profil et on rouvre le lien (précise EVT-12 : le PIN de chaque profil reste respecté). Un honoré de la surprise, un profil bloqué par l'auteur du lien ou par un organisateur, un lien révoqué, épuisé ou expiré reçoivent **la même réponse** qu'un jeton inconnu, rendue au même temps plancher (500 ms depuis la réception), pour que la durée ne distingue pas un lien refusé d'un lien inconnu (GFT-07). Un profil enfant ne rejoint par lien que si l'auteur du lien est dans son cercle (`403 EVENT_CHILD_OUTSIDE_CIRCLE`). Un profil déjà participant retrouve l'événement sans consommer d'usage.
- **EVT-17** **Retrait.** Un organisateur retire un participant, sauf le créateur ; le retiré perd l'accès à la requête suivante. Ses listes restent rattachées.
- **EVT-18** **Réponse.** Modifiable jusqu'à la fin de la date ; figée ensuite, et quand l'événement est annulé.

## Répondre et composer sa liste

- **EVT-20** En répondant `Participe` à un événement d'échange, le profil arrive sur un assistant en trois étapes, chacune facultative :
  1. **Reprendre mes souhaits non obtenus** : souhaits de ses listes passées qu'il n'a pas cochés « reçu » (LST-14), présélectionnés, à décocher.
  2. **Piocher des idées** : recherche dans sa liste « Mes envies », dans les listes des autres auxquelles il a accès, dans le répertoire de son cercle et le catalogue global.
  3. **Ajouter du neuf** : lien, photo ou saisie.
- **EVT-21** Reprendre un souhait non obtenu le **déplace par référence** : le même souhait apparaît dans la nouvelle liste et l'ancienne liste garde une trace « reporté vers… ». Ses commentaires publics suivent, son fil des offreurs repart de zéro.
- **EVT-22** La liste des « non obtenus » est calculée par le serveur **sans rien révéler** : elle contient tous les souhaits passés du profil qu'il n'a pas cochés « reçu » ni retirés, **quel que soit leur état réel**. Un souhait secrètement réservé ou acheté y figure comme les autres : l'en retirer trahirait l'achat par son absence.
  Précisément : les éléments qu'il voit en vue destinataire (ni suggestion, ni écartés par une règle, VIS-17), sur les wishlists dont il est destinataire, rattachées à un autre événement dont la date est passée ou qui est clos, hors corbeille, sans reçu, non retirés et pas encore repris (EVT-21). Ils sont rendus en vue destinataire (VIS-35), triés par date d'événement décroissante puis par l'ordre de leur liste ; aucun filtre ne distingue `OUVERT`, `RÉSERVÉ` et `ACHETÉ` (seuls le reçu et le retrait, gestes du destinataire, en écartent un souhait).
- **EVT-27** **Reprise.** Reprendre un souhait crée dans la liste visée (une wishlist de l'événement dont le profil est destinataire et contributeur) un nouvel élément sur la même fiche, avec la même quantité, le même prix, la même priorité, la même note et la même règle, qui désigne son origine. Un élément ne se reprend qu'une fois (unicité en base). L'ancien reste dans son ancienne liste, avec son état et ses engagements, et porte « reporté », visible de tous ceux qui le voient. Le nouveau part neutre : la compta de l'ancien événement n'est pas touchée. REP-10 s'applique comme à tout ajout.
- **EVT-28** **Mention de EVT-26.** Le nouvel élément porte, **en vue offreur seulement**, l'état réel de son origine quand elle est réservée ou achetée, et le titre et la date de l'ancien événement si le lecteur le voit ; sinon la mention seule (« déjà acheté pour un événement passé »).
- **EVT-29** **Listes de l'événement.** L'autorité d'une liste (LST-04) qui participe à l'événement (`Participe` ou `Peut-être`) peut l'y rattacher (EVT-24) si elle n'est ni personnelle, ni archivée, ni à la corbeille, ni rattachée ailleurs ; en échange, toute wishlist de participant et toute giftlist ; « à l'honneur », les wishlists des seuls honorés et les giftlists de tous. Rattacher ne change pas l'audience (on n'élargit jamais en silence) ; l'interface propose `ÉVÉNEMENT`. Détacher est permis à l'autorité ; une audience `ÉVÉNEMENT` devient alors `MEMBRES`. Une giftlist rattachée peut viser, outre le cercle de son créateur (LST-07), les honorés de l'événement, ou ses participants en échange, y compris hors cercle.
- **EVT-36** **Liste créée à la réponse.** La première réponse `Participe` d'un participant à un échange, ou d'un honoré hors surprise, lui crée une wishlist rattachée, s'il n'en a pas déjà une : titre de l'événement, audience `ÉVÉNEMENT`, lui pour destinataire et créateur. La réponse rend son identifiant ; l'assistant s'ouvre dessus (EVT-25).
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
- **EVT-37** **Calcul de EVT-30 et EVT-31.** L'avancement ne porte que sur les listes de l'événement que le lecteur voit **en offreur**, et les éléments qu'il y voit : une liste dont il est destinataire, même co-destinataire, n'y entre jamais. « A un offreur » : au moins un engagement (VIS-16) ; jusqu'à la compta (phase 5), aucun. « Qui n'a encore rien » : parmi les destinataires de ces mêmes listes, hors le lecteur, ceux dont aucun élément n'a d'offreur. Qui figure dans l'ensemble de départ ne dépend que des listes que le lecteur voit, jamais d'un état.
- **EVT-38** **Clôture.** Un événement `TERMINÉ` ou annulé met ses listes en lecture seule, comme archivées, sauf le reçu (LST-18, GFT-11) et, en phase 5, le pointage des remboursements. Le passage à `TERMINÉ` est fait par une tâche planifiée. L'événement reste visible de ses participants.
- **EVT-39** **Modification et suppression.** Un organisateur modifie titre, date, lieu, description, type, budget et ajoute des honorés tant que l'événement est à venir. Le créateur seul le supprime : ses listes sont détachées (EVT-29), ses invitations révoquées.
- **EVT-40** **Recréation** (EVT-35). Un organisateur d'un événement passé ou clos le recrée un an plus tard (29 février → 28 février), avec les mêmes titre, type, forme, surprise, budget et honorés ; les autres participants sont réinvités (`En attente`, e-mail de EVT-15), les organisateurs le restent, celui qui recrée devient créateur. Les listes ne sont pas reprises : chacun reprend ses souhaits (EVT-21).
- **EVT-41** **Notifications et engagements à venir.** Rappels (EVT-13), avis de reprise (EVT-26), invitation du lendemain (EVT-32), annulation et alerte aux organisateurs (EVT-34, critère « Ne participe pas ») passent par un port de notification vide jusqu'à la phase 4 ; les engagements, par le port de VIS-16, vide jusqu'à la phase 5.

## Valeurs par défaut

| Réglage                          | Défaut                                                                   |
| -------------------------------- | ------------------------------------------------------------------------ |
| Forme                            | `Échange` pour Noël, `À l'honneur` pour anniversaire, naissance, mariage |
| Surprise                         | Non                                                                      |
| Rappels                          | J-14 et J-3                                                              |
| Audience des listes              | Participants de l'événement                                              |
| Souhaits non obtenus à l'étape 1 | Tous présélectionnés                                                     |
| Usages d'un lien d'invitation    | 20                                                                       |
| Liste créée à la réponse         | Titre de l'événement, audience `ÉVÉNEMENT`                               |
| Audience d'une liste rattachée   | Inchangée ; `ÉVÉNEMENT` proposée                                         |

## Critères d'acceptation

- Un profil qui répond `Participe` obtient une liste rattachée à l'événement en trois gestes au plus.
- Le contenu de l'étape 1 est identique, pour un destinataire, que ses souhaits passés soient ouverts, réservés ou achetés (aucune fuite par différence) ; seuls ses souhaits cochés « reçu » en sont absents.
- Un participant qui passe à `Ne participe pas` perd l'accès aux listes des autres à la requête suivante ; ses réservations en cours déclenchent une alerte aux organisateurs.
- Le destinataire d'un événement surprise ne reçoit ni notification, ni e-mail, ni entrée de calendrier.
- L'honoré d'un événement surprise obtient sur toutes les routes, lien d'invitation compris, les mêmes réponses qu'un profil étranger à l'événement.
- L'avancement et « qui n'a encore rien » ne portent jamais sur une liste dont le lecteur est destinataire.

## Questions ouvertes

1. Tirage au sort (« Secret Santa ») : voir `15-suggestions.md`.

Décidé le 2026-11-16 : un invité sans compte ne consulte rien, le lien exige une session (EVT-11, EVT-16).
