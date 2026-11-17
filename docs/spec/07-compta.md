# 07 — Compta des participations

## Objectif

Savoir à tout moment qui offre quoi, combien chacun s'est engagé à payer, qui achète, et qui doit encore quoi à qui. L'application **suit** l'argent, elle ne le déplace pas.

## Vocabulaire

- **Participation** : engagement d'un profil sur un élément.
- **Acheteur** : le profil qui paie le marchand.
- **Part** : montant dû par un participant à l'acheteur.
- **Règlement** : le fait qu'une part a été remboursée (ou avancée) à l'acheteur.

## Participer

- **CPT-01** Sur un élément qu'il voit et dont il n'est pas destinataire, un profil choisit :

| Mode               | Saisie        | Montant                   |
| ------------------ | ------------- | ------------------------- |
| **Tout**           | —             | Coût total restant        |
| **Un pourcentage** | 1 à 100 %     | Pourcentage du coût total |
| **Un montant**     | Montant libre | Ce montant                |

- **CPT-02** Le bouton principal est « Je l'offre » (mode Tout). « Participer » ouvre les deux autres modes. Un élément déjà entamé propose d'office « Compléter (reste 23 €) ».
- **CPT-03** La somme des participations ne peut pas dépasser le coût total. Le contrôle est fait par le serveur, dans une transaction : si deux profils prennent le dernier reste en même temps, le second reçoit « Quelqu'un vient de compléter ce cadeau » avec le reste à jour.
- **CPT-04** Élément à quantité multiple : on participe au coût total par défaut ; « offrir 2 exemplaires sur 5 » est un raccourci qui calcule le montant.
- **CPT-05** Élément sans prix (EXT-20) : participations en montant fixe ; pas de notion de reste. Exception : « Je l'offre » reste permis (CPT-55).
- **CPT-06** Un participant modifie ou retire sa participation librement tant que l'achat n'est pas coché. Après, il doit demander à l'acheteur, qui seul peut corriger, sauf dans le cas d'un écart de prix (CPT-18).
- **CPT-07** Arrondis : les parts en pourcentage sont arrondies au centime inférieur, les centimes restants sont attribués un par un aux participants dans l'ordre d'arrivée. La somme des parts est toujours exactement égale au total.
- **CPT-53** **Pourcentage exact.** Un pourcentage est une fraction exacte du coût total : saisi en pour cent (au centième près, 0,01 à 100) ou en part (« un tiers » : dénominateur de 2 à 10). Chaque part en pourcentage vaut le coût total multiplié par sa fraction, arrondi au centime inférieur. Les centimes perdus ne sont distribués (CPT-07) que si les fractions couvrent exactement ce que laissent les montants fixes ; sinon ils restent dans le reste. L'**ordre d'arrivée** est celui de la première participation du profil sur l'élément : la modifier ne lui fait pas perdre son rang.
- **CPT-54** **Tout.** La participation en mode Tout vaut le coût total moins toutes les autres parts : elle complète, et absorbe donc les arrondis. Il y en a une au plus par élément, et elle n'est acceptée que s'il reste quelque chose à couvrir. Elle ne rétrécit jamais par le geste d'un autre participant : tant qu'elle existe, il ne reste rien ; elle grandit quand une autre part se retire ou baisse.
- **CPT-55** **Je l'offre sans prix** (exception à CPT-05). Sur un élément sans prix, « Je l'offre » crée une participation Tout de **montant inconnu** ; les autres participent en montant fixe. À l'achat, le prix payé devient obligatoire et la part Tout vaut ce prix moins les montants fixes ; si les montants fixes le dépassent, la baisse se reporte selon CPT-17.
- **CPT-56** **Exemplaires.** « Offrir 2 exemplaires sur 5 » (CPT-04) crée une participation en montant fixe de 2 × le prix unitaire, calculée par le serveur ; le nombre d'exemplaires est gardé pour l'affichage.
- **CPT-57** **Prix changé avant l'achat.** Un changement du prix ou de la quantité d'un élément est **toujours accepté** : le refuser trahirait au destinataire que son souhait est réservé (VIS-20). La compta garde son propre **coût prévu**, relevé à la première participation. S'il n'y a qu'un participant, ou si la revue est décochée (CPT-58), le nouveau coût s'applique aussitôt comme un écart, avec le droit de refuser une hausse (CPT-18) et la fenêtre CPT-19. Avant l'achat, « comme un écart » se lit ainsi : une part en pourcentage reste le même pourcentage du nouveau coût et la part Tout complète, ce qui revient à CPT-16 quand l'élément est couvert ; sans part relative, une hausse va au dernier arrivé si l'élément était couvert (CPT-17), et agrandit le reste sinon. Si les parts dépassent le nouveau coût, l'excédent est retiré aux derniers arrivés (CPT-17) ; une part en pourcentage ainsi réduite devient un montant fixe. À l'achat, les montants sont figés et l'écart suit CPT-16 au prorata des montants. Sinon, il attend la revue. Un changement de devise de l'élément ne s'applique jamais aux parts : il est montré aux offreurs, et le prix payé à l'achat se saisit dans la devise de la compta.
- **CPT-58** **Options de compta et revue.** Chaque élément engagé porte des options réglées par ses participants : la **revue** (cochée par défaut) et le **justificatif** (CPT-15, décoché par défaut). Quand la revue est cochée et que l'élément a plus d'un participant, appliquer un nouveau coût (CPT-57) et modifier les options demandent la **validation d'un autre participant** que l'auteur de la demande ; le premier qui valide ou refuse décide. Une demande plus récente du même genre remplace celle en attente ; l'achat clôt la demande de coût en attente (le prix payé tranche). Tant que rien n'est validé, les parts gardent l'ancien coût prévu, et les offreurs voient les deux prix. Le destinataire ne voit ni les options, ni les demandes.
- **CPT-59** **Qui voit quoi** (précise CPT-52). Tout profil qui voit l'élément en offreur voit qui participe, le mode de chacun, le coût prévu, la part couverte, le reste, l'acheteur et l'état de l'achat. Le **montant** de chaque part, les options, les demandes de revue et le justificatif ne sont lus que par les participants. L'état de règlement d'une part n'est lu que par son participant et par l'acheteur. Un destinataire de la liste n'en reçoit rien, même s'il partage un compte avec un participant.
- **CPT-60** **Qui participe.** Participer, modifier ou retirer sa participation exige de voir l'élément en offreur (donc de ne pas en être destinataire), sur une liste ni archivée ni à la corbeille, un élément non retiré, et un événement ni terminé ni annulé (EVT-38). Sinon : `404` si l'élément n'est pas visible en offreur, `409` (`ACCOUNTING_CLOSED`) sinon.

## Acheteur

- **CPT-10** Chaque élément ayant au moins une participation a **un** acheteur. Par défaut : le premier participant. Tout participant peut se proposer ; le changement demande l'accord de l'acheteur en place, ou d'un organisateur s'il ne répond pas sous 48 heures.
- **CPT-11** L'acheteur a un **panier** : tous les éléments dont il est acheteur, groupés par événement puis par destinataire, avec lien marchand, quantité, total, et état de financement (« 80 % couvert, reste 12 € à votre charge si personne ne complète »).
- **CPT-12** L'acheteur coche **Acheté**. Il peut saisir le **prix réellement payé** (promotion, frais de port). S'il diffère du coût prévu, l'**écart** (en plus ou en moins) est réparti selon CPT-16 à CPT-19.
- **CPT-13** Cocher Acheté passe l'élément à `ACHETÉ` (LST-12) et fige les participations.
- **CPT-14** Décocher est possible pendant 24 heures (erreur de manipulation), puis demande une confirmation et notifie les participants.
- **CPT-15** Un justificatif (photo du ticket) peut être joint ; il est visible des seuls participants.
- **CPT-61** **Acheteur en pratique** (précise CPT-10). Si l'acheteur retire sa participation avant l'achat, le participant suivant dans l'ordre d'arrivée le devient ; sans participation, il n'y a plus d'acheteur. Un participant se propose par une demande, une seule en attente par élément. L'acheteur l'accepte ou la refuse ; passé 48 heures sans réponse, elle peut être acceptée par un organisateur de l'événement qui voit l'élément en offreur, ou, hors événement, par tout autre participant. L'acheteur ne change plus après l'achat (sauf à le décocher).
- **CPT-62** **Justificatif en pratique** (précise CPT-15). Il n'est possible que si l'option est cochée (CPT-58) et n'est jamais obligatoire. L'acheteur le joint à l'achat ou après, et peut le remplacer. La photo est décodée et ré-encodée par le service isolé, sans métadonnées (EXT-46), et n'est servie qu'aux participants.
- **CPT-63** **Décocher en pratique** (précise CPT-14). Pendant 24 heures, décocher est libre ; ensuite la requête doit porter une confirmation explicite, et les participants sont notifiés. Décocher rend les parts d'avant l'achat, ferme la fenêtre de refus (CPT-18) et repasse les parts `À RÉGLER` ou `À CONFIRMER` à « rien à régler » ; les parts déjà réglées le restent (« avancée »).
- **CPT-64** **Reste non couvert** (précise CPT-19). Au lendemain de la date de l'événement, un reste à couvrir est ajouté à la part de l'acheteur, par une écriture au journal ; hors événement, il reste affiché jusqu'à ce que quelqu'un le couvre ou que l'acheteur l'ajoute à sa part.

## Écart de prix à l'achat

- **CPT-16** **Parts relatives d'abord.** Si au moins un participant est en mode **Tout** ou **Pourcentage**, l'écart est réparti entre eux seuls, au prorata de leur part, avec les arrondis de CPT-07. Les montants fixes ne bougent pas.
- **CPT-17** **Tous en montant fixe.** L'écart est reporté sur le **dernier participant arrivé**. Si c'est une baisse plus grande que sa part, le surplus passe à l'avant-dernier, et ainsi de suite (une part ne descend jamais sous zéro).
- **CPT-18** **Refus d'une hausse.** Tout participant dont la part augmente est notifié et peut, pendant 7 jours, la ramener à un montant inférieur, sans descendre sous son montant d'avant l'achat. La différence devient un **reste à couvrir**.
- **CPT-19** **Fenêtre de notification.** Quand une action laisse un reste à couvrir, une fenêtre s'ouvre pour son auteur :

  > Il reste 18 € à couvrir sur _Robot pâtissier_. Prévenir les autres participants ?
  > ☑ Paul ☑ Marie ☐ Tom
  > [Prévenir] [Ne prévenir personne]

  Tous les participants sont cochés par défaut ; on peut en décocher certains, pour ne pas mettre mal à l'aise ceux qui ont un petit budget. Les personnes cochées reçoivent la notification et peuvent augmenter leur part. Les autres voient le reste à couvrir dans l'élément mais ne sont pas notifiées. Un reste qui n'est couvert par personne à la date de l'événement est à la charge de l'acheteur. Le choix des personnes prévenues n'est visible que de son auteur.

## Règlements

- **CPT-20** Après l'achat, chaque part d'un participant autre que l'acheteur est `À RÉGLER`. L'acheteur la passe à `RÉGLÉE` quand il a reçu l'argent, en la cochant dans son panier.
- **CPT-21** Une part peut être marquée `RÉGLÉE` **avant** l'achat (le participant a avancé sa part). Le libellé est alors « avancée ».
- **CPT-22** Le participant peut signaler « j'ai payé » ; la part passe à `À CONFIRMER` et l'acheteur est notifié. Seul l'acheteur confirme. Cela évite les désaccords silencieux.
- **CPT-23** Rappel automatique au participant 7 jours après l'achat si sa part n'est pas réglée, puis à la date de l'événement. L'acheteur peut relancer à la main, une fois par 48 heures.
- **CPT-24** Moyen de règlement : champ libre facultatif (« virement », « espèces »). L'application n'affiche ni ne stocke de coordonnées bancaires en v1.
- **CPT-65** **Montant réglé.** Une part garde le montant déjà réglé. Ce qui reste dû est sa valeur moins ce montant : si la part augmente après règlement (écart, reste non couvert), elle repasse `À RÉGLER` pour la différence. La part de l'acheteur n'a jamais rien à régler. L'acheteur peut annuler un règlement par erreur, et refuser un « j'ai payé » (la part revient `À RÉGLER`) ; chaque geste est une écriture au journal. Une participation dont une partie est réglée ne se retire pas (`409 CONTRIBUTION_SETTLED`) : l'acheteur annule d'abord le règlement. Le moyen de règlement (CPT-24) fait 60 caractères au plus.
- **CPT-66** **Rappels en pratique** (précise CPT-23). Chaque rappel automatique part une seule fois ; hors événement, seul celui de J+7 existe. La relance à la main est refusée (`429`) moins de 48 heures après la précédente, pour cette part.

## Soldes

- **CPT-30** Vue **Comptes** par événement, et vue globale : pour chaque autre profil, ce que je lui dois et ce qu'il me doit, avec le détail des éléments.
- **CPT-31** **Compensation** entre deux profils : si je dois 20 € à Paul et qu'il m'en doit 15 €, la vue affiche « vous devez 5 € à Paul » et permet de solder les parts concernées des deux côtés en une action, que chacun confirme.
- **CPT-32** Pas de simplification à plus de deux personnes en v1 (rembourser Marie à la place de Paul). C'est efficace mais déroutant ; à garder pour plus tard.
- **CPT-33** Les soldes ne mélangent jamais deux devises.
- **CPT-67** **Calcul des soldes.** Entre deux profils, un solde ne compte que les parts de l'un sur un élément dont l'autre est acheteur, pour ce qui reste dû (CPT-65), devise par devise. La vue par événement prend les éléments des listes rattachées à l'événement ; la vue globale, tous. Un élément supprimé garde l'événement relevé à sa suppression (CPT-73).
- **CPT-68** **Compensation en pratique** (précise CPT-31). L'un des deux propose, l'autre confirme ; une proposition en attente par paire et par devise. À la confirmation, les montants dus du sens le plus faible sont réglés en entier et ceux de l'autre sens à hauteur du même total, part par part dans l'ordre des achats ; une écriture au journal par part touchée. Une part qui a changé entre la proposition et la confirmation annule la proposition (`409`).

## Budget et vue latérale

- **CPT-40** Un profil peut fixer un budget : global pour un événement, et facultativement par destinataire. Le budget est **privé** : personne d'autre ne le voit, pas même les autres profils du compte.
- **CPT-41** **Vue latérale** (panneau à droite sur grand écran, tiroir depuis le bas sur mobile), ouverte dès qu'on participe à un élément dans le contexte d'un événement :

```
Noël 2026                      Budget 300 €
████████████░░░░░░  212 € engagés · reste 88 €

Léa                                   95 €
  Vélo (part 40 %)            60 €   à régler à Paul
  Livre                       35 €   j'achète · acheté ✔
Mamie                         117 €
  Robot pâtissier (tout)     117 €   j'achète
Papa                            0 €   rien encore
```

- **CPT-42** Hiérarchie : événement → destinataire → élément. Pour chaque élément : ma part, mon mode (tout, pourcentage, montant), mon rôle (acheteur ou non), l'état.
- **CPT-43** Ajouter une participation met à jour le panneau immédiatement, avec animation du total. Dépasser le budget n'est jamais bloquant : la jauge change de couleur et un message discret l'indique.
- **CPT-44** La ligne « rien encore » liste les destinataires de l'événement pour qui je n'ai rien prévu.
- **CPT-45** Hors événement, la vue latérale regroupe par mois.
- **CPT-69** **Budget en pratique.** Montant strictement positif, dans une devise ; un budget par événement, et un par destinataire de cet événement au plus. « Engagé » est la somme de mes parts sur les éléments de l'événement que je vois en offreur, dans la devise du budget ; une part dans une autre devise est montrée à part, jamais convertie. Hors événement (CPT-45), le mois est celui de ma première participation sur l'élément.

## Intégrité

- **CPT-50** Toute opération de compta est une écriture ajoutée à un journal immuable (qui, quoi, quand, avant, après). Les états affichés en sont dérivés. Rien n'est effacé.
- **CPT-51** Chaque opération porte une clé d'idempotence : rejouée (hors ligne, double clic), elle n'a d'effet qu'une fois.
- **CPT-52** Toute la compta est soumise à la règle de surprise : le destinataire n'en voit rien, y compris dans les soldes d'un événement où il est aussi offreur pour d'autres.
- **CPT-70** **Journal en pratique** (précise CPT-50). Chaque opération écrit, dans la transaction qui la fait, une écriture par ligne touchée, avec l'état d'avant et d'après. Rejouer le journal d'un élément jusqu'à une date redonne son état à cette date ; un test le vérifie sur chaque genre d'écriture. Le journal ne quitte jamais la base : aucun montant ni nom dans les journaux techniques, traces, métriques ou rapports d'erreur (OBS-20).
- **CPT-71** **Idempotence en pratique** (précise CPT-51 et API-16). Toute mutation de compta exige l'en-tête `Idempotency-Key` (sinon `422 IDEMPOTENCY_KEY_REQUIRED`). La clé vaut pour le profil actif pendant 30 jours (une file hors ligne peut avoir plusieurs jours de retard). Même clé et même requête : la première réponse est rendue, sans nouvel effet ; même clé et requête différente : `409 IDEMPOTENCY_KEY_REUSED`.
- **CPT-72** **Événement terminé ou annulé** (EVT-34, EVT-38). On ne participe plus, on ne modifie ni ne retire sa participation, on ne change plus d'acheteur ni d'options. Restent permis : cocher et décocher l'achat, le justificatif, le prix payé, le refus d'une hausse (CPT-18), les règlements et la compensation. Les participations d'un événement annulé portent « événement annulé ».
- **CPT-73** **Élément supprimé ou retiré.** Une suppression d'élément, ou la purge de sa liste, ne peut ni échouer ni différer à cause de la compta (ce serait un indice, VIS-20). Les participations, l'achat et le journal sont conservés, détachés de l'élément, avec son titre et son événement relevés en base au moment de la suppression ; les participants sont notifiés, comme pour un retrait (LST-15). Un élément détaché ou retiré n'accepte plus de participation ; les participants peuvent retirer la leur tant que l'achat n'est pas coché, et l'achat, les règlements et la compensation continuent.
- **CPT-74** **Avis de compta** (NOT-12, catégorie « cadeaux »). Chaque avis est produit par candidat à travers le moteur, sous la forme offreur (NOT-10) : un destinataire n'en reçoit aucun. Une première participation avertit les autres participants ; l'achat coché et décoché aussi ; une demande de revue, les autres participants ; une demande de changement d'acheteur, l'acheteur ; un « j'ai payé », l'acheteur ; une relance ou un rappel (CPT-23), le seul participant concerné ; un reste à couvrir, les seules personnes choisies (CPT-19). Un participant engagé qui répond « Ne participe pas » alerte les organisateurs, sauf ceux qui sont destinataires d'une liste où il est engagé (VIS-20). Un participant qui ne voit plus l'élément (VIS-37) ou dont l'élément a disparu (CPT-73) ne reçoit plus d'avis en v1.

## Valeurs par défaut

| Réglage               | Défaut                                      |
| --------------------- | ------------------------------------------- |
| Mode de participation | Tout                                        |
| Acheteur              | Premier participant                         |
| Budget                | Aucun                                       |
| Rappel de part        | J+7 après l'achat, puis date de l'événement |
| Revue (CPT-58)        | Cochée                                      |
| Justificatif (CPT-58) | Décoché                                     |

## Critères d'acceptation

- Sur 100,00 €, trois participations à 33 % donnent 33,00 € chacune et laissent exactement 1,00 € de reste. Sur 100,00 € partagés en trois parts égales couvrant tout, les parts sont 33,34 € + 33,33 € + 33,33 €.
- Deux requêtes simultanées pour le dernier reste : une réussit, l'autre reçoit un conflit avec le reste actualisé.
- Seul l'acheteur peut passer une part à `RÉGLÉE`.
- Coût prévu 100 €, prix payé 110 €, participants : A en pourcentage 60 %, B en montant fixe 40 € → A passe à 70 €, B reste à 40 €.
- Coût prévu 100 €, prix payé 110 €, A fixe 30 € puis B fixe 70 € → B passe à 80 €. Si B ramène sa part à 72 €, il reste 8 € à couvrir et la fenêtre CPT-19 s'ouvre pour B.
- Un participant décoché dans la fenêtre CPT-19 ne reçoit aucune notification, par aucun canal.
- Le journal permet de reconstituer l'état de n'importe quel élément à n'importe quelle date.
- Le budget d'un profil n'apparaît dans aucune réponse d'API faite à un autre profil.
- Sur 100,00 €, trois participations d'un tiers donnent 33,34 € + 33,33 € + 33,33 €, le centime allant au premier arrivé (CPT-53).
- Le destinataire change le prix de son souhait réservé par deux offreurs : sa requête réussit comme sur un souhait libre ; les parts ne bougent qu'après la validation d'un autre participant que l'auteur (CPT-57, CPT-58).
- Le destinataire supprime son souhait acheté : la suppression réussit comme sur un souhait libre, et les règlements continuent (CPT-73).
- Rejouer une mutation de compta avec la même clé ne produit qu'une écriture au journal ; la même clé avec une autre requête donne `409` (CPT-71).

## Questions ouvertes

1. Afficher un IBAN ou un lien de paiement (Lydia, Wero, PayPal) sur le profil de l'acheteur : pratique, mais donnée sensible. Reporté.
2. Un organisateur doit-il voir l'état des règlements de tout l'événement ? Défaut : non, chacun ne voit que ce qui le concerne.
