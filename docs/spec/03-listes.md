# 03 — Wishlists et giftlists

## Objectif

Deux types de listes, une seule mécanique : une liste contient des éléments, a des membres avec des rôles, et une audience qui la voit.

## Ce qui est commun

- **LST-01** Une liste a : titre, description facultative, type (`WISHLIST` ou `GIFTLIST`), un ou plusieurs destinataires, un événement de rattachement facultatif, une visibilité par défaut pour ses nouveaux éléments.
- **LST-02** Rôles sur une liste :

| Rôle | Peut |
|---|---|
| **Créateur** | Tout, y compris supprimer la liste, gérer les membres, déléguer des droits. |
| **Responsable** | Comme le créateur, sauf supprimer la liste. Désigné par le créateur ; devient l'autorité si le créateur se retire. |
| **Contributeur** | Ajouter, modifier et retirer ses propres éléments. |
| **Lecteur** | Voir, commenter, réserver, participer (selon les règles de visibilité). |

- **LST-03** **Modification des règles de visibilité.** Par défaut, seul le créateur peut modifier la règle de visibilité d'un élément (liste blanche ou liste noire) et celle par défaut de la liste. S'il s'est retiré, ce droit revient au responsable. Le créateur peut étendre ce droit au rôle responsable ou contributeur, liste par liste. La modification est possible à tout moment et prend effet immédiatement.
- **LST-04** **Retrait et succession.** Un créateur qui quitte la liste doit désigner un responsable parmi les membres. S'il supprime son profil sans l'avoir fait, le contributeur le plus ancien devient responsable ; s'il n'y en a pas, la liste est archivée.
- **LST-05** Une liste peut être archivée (lecture seule, masquée des vues courantes) puis restaurée. La suppression passe par 30 jours de corbeille.
- **LST-06** Ordre des éléments : manuel par glisser-déposer, ou tri par priorité, prix, date d'ajout.

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

## Wishlist

- **WSH-01** Tenue par son ou ses destinataires, qui en sont membres avec le rôle créateur ou contributeur.
- **WSH-02** Trois formes :
  - **Personnelle globale** : attachée au profil, sans événement, toujours ouverte. Chaque profil en a une créée d'office (« Mes envies »).
  - **D'événement** : créée en répondant à une invitation (voir `05-evenements.md`).
  - **Partagée** : plusieurs destinataires (couple, fratrie). Chacun est contributeur, tous sont destinataires de tous les éléments.
- **WSH-03** Audience par défaut : le cercle du ou des destinataires pour une liste personnelle ; les participants de l'événement pour une liste d'événement.
- **WSH-04** Un offreur peut **suggérer** un élément sur la wishlist de quelqu'un : la suggestion est visible des autres offreurs, pas du destinataire, et se réserve comme un souhait. C'est la forme légère d'une giftlist.
- **WSH-05** Sur une liste partagée, aucun des destinataires ne voit les réservations (règle de surprise appliquée à tous).

## Giftlist

- **GFT-01** Tenue par des offreurs pour un ou plusieurs destinataires. Les destinataires **ne sont pas membres** de la liste.
- **GFT-02** Une giftlist peut viser plusieurs profils destinataires à la fois (cadeau commun pour un couple, pour les grands-parents). Chaque élément peut préciser à qui il est destiné, sinon il est destiné à tous.
- **GFT-03** Exposition aux destinataires, deux réglages indépendants :

| Réglage | Valeurs | Défaut |
|---|---|---|
| **Existence** | `CACHÉE` : rien n'apparaît chez le destinataire. `RÉVÉLÉE` : il voit « une liste de cadeaux est en préparation pour vous ». | `CACHÉE` |
| **Contenu** | `AUCUN`, `PARTIEL` (seuls les éléments cochés « montrer »), `COMPLET` | `AUCUN` |

- **GFT-04** `Contenu` autre que `AUCUN` impose `Existence = RÉVÉLÉE`. L'interface règle la cohérence d'elle-même.
- **GFT-05** Même en contenu `COMPLET`, le destinataire ne voit jamais qui participe, les montants des parts ni le fil des offreurs.
- **GFT-06** Le créateur invite les offreurs un par un ou par événement. Un destinataire ne peut pas être invité comme offreur de sa propre giftlist.
- **GFT-07** Une giftlist `CACHÉE` ne doit laisser aucune trace côté destinataire : ni compteur, ni notification, ni résultat de recherche, ni différence de temps de réponse exploitable.
- **GFT-08** Si un destinataire et un offreur partagent le même compte, l'interface avertit le créateur que le secret dépend du PIN (voir PIN-06).

## Valeurs par défaut

| Réglage | Défaut |
|---|---|
| Visibilité d'un nouvel élément | `TOUS` (toute l'audience de la liste) |
| Qui modifie les règles de visibilité | Le créateur seul |
| Giftlist | Existence cachée, contenu masqué |
| Quantité | 1 |
| Priorité | `envie` |

## Critères d'acceptation

- Un contributeur qui tente de modifier la règle de visibilité d'un élément sans y être autorisé reçoit `403`.
- Après retrait du créateur, le responsable désigné peut modifier les règles de visibilité.
- Le destinataire d'une giftlist cachée interroge toutes les routes de l'API : aucune réponse ne diffère de celle d'un profil sans giftlist.
- L'API renvoie au destinataire le même état neutre pour un souhait `OUVERT`, `RÉSERVÉ` ou `ACHETÉ`, avant comme après la date de l'événement ; seul `REÇU` est distingué.
- Un élément `ACHETÉ` n'est jamais proposé à la reprise ; un élément `RÉSERVÉ` non acheté l'est.

## Questions ouvertes

1. Une wishlist partagée peut-elle être transformée en liste personnelle si un co-destinataire part ? Défaut : oui, ses éléments restent.
