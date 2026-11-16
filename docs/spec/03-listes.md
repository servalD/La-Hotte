# 03 — Wishlists et giftlists

## Objectif

Deux types de listes, une seule mécanique : une liste contient des éléments, a des membres avec des rôles, et une audience qui la voit.

## Ce qui est commun

- **LST-01** Une liste a : titre, description facultative, type (`WISHLIST` ou `GIFTLIST`), un ou plusieurs destinataires, un événement de rattachement facultatif, une visibilité par défaut pour ses nouveaux éléments.
- **LST-02** Rôles sur une liste :

| Rôle             | Peut                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Créateur**     | Tout, y compris supprimer la liste, gérer les membres, déléguer des droits.                                        |
| **Responsable**  | Comme le créateur, sauf supprimer la liste. Désigné par le créateur ; devient l'autorité si le créateur se retire. |
| **Contributeur** | Ajouter, modifier et retirer ses propres éléments.                                                                 |
| **Lecteur**      | Voir, commenter, réserver, participer (selon les règles de visibilité).                                            |

- **LST-03** **Modification des règles de visibilité.** Par défaut, seul le créateur peut modifier la règle de visibilité d'un élément (liste blanche ou liste noire) et celle par défaut de la liste. S'il s'est retiré, ce droit revient au responsable. Le créateur peut étendre ce droit au rôle responsable ou contributeur, liste par liste. La modification est possible à tout moment et prend effet immédiatement.
- **LST-04** **Retrait et succession.** Un créateur qui quitte la liste doit désigner un responsable parmi les membres. S'il supprime son profil sans l'avoir fait, le contributeur le plus ancien devient responsable ; s'il n'y en a pas, la liste est archivée.
- **LST-05** Une liste peut être archivée (lecture seule, masquée des vues courantes) puis restaurée. La suppression passe par 30 jours de corbeille.
- **LST-06** Ordre des éléments : manuel par glisser-déposer, ou tri par priorité, prix, date d'ajout.
- **LST-07** **Destinataires.** Une wishlist a pour destinataires son créateur ou des profils de son compte (un parent tient la liste de son enfant) ; une giftlist, des profils du cercle de son créateur (LNK-09), jamais lui-même. Le créateur et le responsable ajoutent des destinataires dans les mêmes limites, contrôlées pour une wishlist contre le compte de ses destinataires (pas contre celui de l'auteur du changement). **Un destinataire ne se retire jamais** : il deviendrait offreur de ce qu'on lui prépare (VIS-20) ; il reste destinataire jusqu'à la suppression de la liste ou de son profil. « Mes envies » (WSH-02) a pour seul destinataire son profil, qui en est créateur, et ne change pas de destinataire. Une giftlist rattachée à un événement peut aussi viser ses honorés, ou ses participants en échange, hors du cercle (EVT-29).
- **LST-08** **Membres.** Le créateur et le responsable ajoutent un membre parmi les profils de leur propre cercle (aucune recherche hors du cercle, LNK-04), avec le rôle responsable, contributeur ou lecteur, et le retirent. Un membre qui n'est pas destinataire est un offreur. Un destinataire de giftlist ne peut pas en être membre (GFT-01), en base aussi.
- **LST-09** **Autorité sans créateur.** Quand le créateur s'est retiré, le plus ancien responsable a tous ses droits, suppression de la liste comprise.
- **LST-20** **Corbeille.** Une liste supprimée n'est plus visible que de son créateur (ou de l'autorité de LST-09), qui peut la restaurer pendant 30 jours ; elle est ensuite purgée avec ses éléments. « Mes envies » ne se supprime ni ne s'archive.

## Cycle de vie d'un élément

```
OUVERT ──réservation──▶ RÉSERVÉ ──achat coché──▶ ACHETÉ (supposé reçu) ──confirmation──▶ REÇU
   ▲                        │
   └──── annulation ────────┘
```

- **LST-10** `OUVERT` : personne ne s'est engagé.
- **LST-11** `RÉSERVÉ` : au moins une réservation ou participation. Partiel tant que le coût total ou la quantité n'est pas couvert.
- **LST-12** `ACHETÉ` : l'acheteur a coché l'achat. L'élément est alors **supposé reçu**, affiché en **bleu**, **pour les offreurs seulement** (LST-16).
- **LST-13** `REÇU` : le destinataire a coché « reçu » sur son souhait, affichage en **vert** pour tous. Il peut le faire quel que soit l'état réel, y compris pour un cadeau acheté hors de l'application. La confirmation est facultative et n'a aucun effet sur la compta.
- **LST-14** **Non obtenu**, du point de vue du destinataire = souhait qu'il n'a pas coché « reçu » (et qu'il n'a pas retiré, LST-15). C'est la seule définition utilisée pour la reprise dans une liste suivante (`05-evenements.md`, EVT-22) : l'état réel n'y entre pas.
- **LST-15** Le destinataire peut déclarer « je l'ai déjà » ou « je n'en veux plus » sur son souhait : l'élément est retiré de la liste active. S'il était réservé, les offreurs concernés sont notifiés.
- **LST-16** **Ce que voit le destinataire.** Il ne connaît que deux états pour ses souhaits : **neutre** et **reçu** (vert, quand il l'a coché). Il ne voit jamais `RÉSERVÉ` ni `ACHETÉ` (bleu), ni avant ni après l'événement : seuls les participants voient le bleu. Il n'y a pas de « révélation » de l'état.
- **LST-17** Le destinataire ne peut d'aucune façon savoir qu'un souhait est réservé, même sans savoir par qui. Il n'existe pas d'option pour le montrer. C'est aux offreurs de prévenir le destinataire, s'ils le jugent utile, par le fil public (« ne l'achète pas toi-même ! »).
- **LST-18** **Reçu.** Seul un destinataire d'une wishlist coche « reçu » sur l'un de ses souhaits, et peut le décocher. Le reçu est porté à part (`received_at`) : l'état réel (`OUVERT`, `RÉSERVÉ`, `ACHETÉ`) n'est jamais écrasé, et la vue offreur montre `REÇU` tant que le reçu est coché. Pour une giftlist, voir GFT-11.
- **LST-19** **Retrait.** « Je l'ai déjà » et « je n'en veux plus » (LST-15) retirent l'élément de la liste active pour tous ; le motif est gardé. Un élément retiré n'apparaît plus dans aucune lecture de la liste.

## Wishlist

- **WSH-01** Tenue par son ou ses destinataires, qui en sont membres avec le rôle créateur ou contributeur.
- **WSH-02** Trois formes :
  - **Personnelle globale** : attachée au profil, sans événement, toujours ouverte. Chaque profil en a une créée d'office (« Mes envies »).
  - **D'événement** : créée en répondant à une invitation (voir `05-evenements.md`).
  - **Partagée** : plusieurs destinataires (couple, fratrie). Chacun est contributeur, tous sont destinataires de tous les éléments.
- **WSH-03** Audience par défaut : le cercle du ou des destinataires pour une liste personnelle ; les participants de l'événement pour une liste d'événement.
- **WSH-04** Un offreur peut **suggérer** un élément sur la wishlist de quelqu'un : la suggestion est visible des autres offreurs, pas du destinataire, et se réserve comme un souhait. C'est la forme légère d'une giftlist.
- **WSH-05** Sur une liste partagée, aucun des destinataires ne voit les réservations (règle de surprise appliquée à tous).
- **WSH-06** « Mes envies » est créée à la première lecture des listes du profil, une seule par profil (unicité en base) : pour lui, c'est « d'office ».
- **WSH-07** Une suggestion (WSH-04) peut être faite par tout offreur qui voit la liste. Elle n'est modifiable et retirable que par son auteur, et n'est jamais montrée à un destinataire, même créateur de la liste.

## Giftlist

- **GFT-01** Tenue par des offreurs pour un ou plusieurs destinataires. Les destinataires **ne sont pas membres** de la liste.
- **GFT-02** Une giftlist peut viser plusieurs profils destinataires à la fois (cadeau commun pour un couple, pour les grands-parents). Chaque élément peut préciser à qui il est destiné, sinon il est destiné à tous.
- **GFT-03** Exposition aux destinataires, deux réglages indépendants :

| Réglage       | Valeurs                                                                                                                     | Défaut   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Existence** | `CACHÉE` : rien n'apparaît chez le destinataire. `RÉVÉLÉE` : il voit « une liste de cadeaux est en préparation pour vous ». | `CACHÉE` |
| **Contenu**   | `AUCUN`, `PARTIEL` (seuls les éléments cochés « montrer »), `COMPLET`                                                       | `AUCUN`  |

- **GFT-04** `Contenu` autre que `AUCUN` impose `Existence = RÉVÉLÉE`. L'interface règle la cohérence d'elle-même.
- **GFT-05** Même en contenu `COMPLET`, le destinataire ne voit jamais qui participe, les montants des parts ni le fil des offreurs.
- **GFT-06** Le créateur invite les offreurs un par un ou par événement. Un destinataire ne peut pas être invité comme offreur de sa propre giftlist.
- **GFT-07** Une giftlist `CACHÉE` ne doit laisser aucune trace côté destinataire : ni compteur, ni notification, ni résultat de recherche, ni différence de temps de réponse exploitable.
- **GFT-08** Si un destinataire et un offreur partagent le même compte, l'interface avertit le créateur que le secret dépend du PIN (voir PIN-06).
- **GFT-09** **Ce que voit le destinataire d'une giftlist révélée.** L'existence seule, par la phrase fixe de GFT-03 : ni titre, ni description, ni créateur, ni membres. Avec un contenu `PARTIEL` ou `COMPLET`, les éléments montrés le sont en vue destinataire, sauf ceux dont la règle l'exclut (VIS-10) ; un élément retiré ou une suggestion ne l'est jamais.
- **GFT-10** Pour la règle de surprise, chaque destinataire d'une giftlist est destinataire de chacun de ses éléments, quel que soit le destinataire précisé (GFT-02).
- **GFT-11** **Reçu d'un cadeau.** Sur une giftlist, « reçu » est coché ou décoché par un destinataire sur un élément qui lui est montré (GFT-09), ou par le créateur ou un responsable, qui constate la remise. Les offreurs le voient en vert (`REÇU`) ; le destinataire, sur les seuls éléments qui lui sont montrés. L'état réel n'est jamais écrasé (LST-18).

## Valeurs par défaut

| Réglage                              | Défaut                                |
| ------------------------------------ | ------------------------------------- |
| Visibilité d'un nouvel élément       | `TOUS` (toute l'audience de la liste) |
| Qui modifie les règles de visibilité | Le créateur seul                      |
| Giftlist                             | Existence cachée, contenu masqué      |
| Quantité                             | 1                                     |
| Priorité                             | `envie`                               |

## Critères d'acceptation

- Un contributeur qui tente de modifier la règle de visibilité d'un élément sans y être autorisé reçoit `403`.
- Après retrait du créateur, le responsable désigné peut modifier les règles de visibilité.
- Le destinataire d'une giftlist cachée interroge toutes les routes de l'API : aucune réponse ne diffère de celle d'un profil sans giftlist.
- L'API renvoie au destinataire le même état neutre pour un souhait `OUVERT`, `RÉSERVÉ` ou `ACHETÉ`, avant comme après la date de l'événement ; seul `REÇU` est distingué.
- Un élément est proposé à la reprise quel que soit son état réel (`OUVERT`, `RÉSERVÉ` ou `ACHETÉ`) tant que le destinataire ne l'a pas coché « reçu » ni retiré (LST-14, EVT-22). Corrigé le 2026-11-16 : ce critère disait l'inverse pour `ACHETÉ`, en contradiction avec EVT-22 et la décision du 2026-11-12 ; l'absence d'un souhait acheté trahirait l'achat.

## Questions ouvertes

1. Une wishlist partagée peut-elle être transformée en liste personnelle si un co-destinataire part ? Défaut : oui, ses éléments restent.
