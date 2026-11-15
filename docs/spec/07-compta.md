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
- **CPT-05** Élément sans prix (EXT-20) : participations en montant fixe uniquement ; pas de notion de reste.
- **CPT-06** Un participant modifie ou retire sa participation librement tant que l'achat n'est pas coché. Après, il doit demander à l'acheteur, qui seul peut corriger, sauf dans le cas d'un écart de prix (CPT-18).
- **CPT-07** Arrondis : les parts en pourcentage sont arrondies au centime inférieur, les centimes restants sont attribués un par un aux participants dans l'ordre d'arrivée. La somme des parts est toujours exactement égale au total.

## Acheteur

- **CPT-10** Chaque élément ayant au moins une participation a **un** acheteur. Par défaut : le premier participant. Tout participant peut se proposer ; le changement demande l'accord de l'acheteur en place, ou d'un organisateur s'il ne répond pas sous 48 heures.
- **CPT-11** L'acheteur a un **panier** : tous les éléments dont il est acheteur, groupés par événement puis par destinataire, avec lien marchand, quantité, total, et état de financement (« 80 % couvert, reste 12 € à votre charge si personne ne complète »).
- **CPT-12** L'acheteur coche **Acheté**. Il peut saisir le **prix réellement payé** (promotion, frais de port). S'il diffère du coût prévu, l'**écart** (en plus ou en moins) est réparti selon CPT-16 à CPT-19.
- **CPT-13** Cocher Acheté passe l'élément à `ACHETÉ` (LST-12) et fige les participations.
- **CPT-14** Décocher est possible pendant 24 heures (erreur de manipulation), puis demande une confirmation et notifie les participants.
- **CPT-15** Un justificatif (photo du ticket) peut être joint ; il est visible des seuls participants.

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

## Soldes

- **CPT-30** Vue **Comptes** par événement, et vue globale : pour chaque autre profil, ce que je lui dois et ce qu'il me doit, avec le détail des éléments.
- **CPT-31** **Compensation** entre deux profils : si je dois 20 € à Paul et qu'il m'en doit 15 €, la vue affiche « vous devez 5 € à Paul » et permet de solder les parts concernées des deux côtés en une action, que chacun confirme.
- **CPT-32** Pas de simplification à plus de deux personnes en v1 (rembourser Marie à la place de Paul). C'est efficace mais déroutant ; à garder pour plus tard.
- **CPT-33** Les soldes ne mélangent jamais deux devises.

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

## Intégrité

- **CPT-50** Toute opération de compta est une écriture ajoutée à un journal immuable (qui, quoi, quand, avant, après). Les états affichés en sont dérivés. Rien n'est effacé.
- **CPT-51** Chaque opération porte une clé d'idempotence : rejouée (hors ligne, double clic), elle n'a d'effet qu'une fois.
- **CPT-52** Toute la compta est soumise à la règle de surprise : le destinataire n'en voit rien, y compris dans les soldes d'un événement où il est aussi offreur pour d'autres.

## Valeurs par défaut

| Réglage               | Défaut                                      |
| --------------------- | ------------------------------------------- |
| Mode de participation | Tout                                        |
| Acheteur              | Premier participant                         |
| Budget                | Aucun                                       |
| Rappel de part        | J+7 après l'achat, puis date de l'événement |

## Critères d'acceptation

- Sur 100,00 €, trois participations à 33 % donnent 33,00 € chacune et laissent exactement 1,00 € de reste. Sur 100,00 € partagés en trois parts égales couvrant tout, les parts sont 33,34 € + 33,33 € + 33,33 €.
- Deux requêtes simultanées pour le dernier reste : une réussit, l'autre reçoit un conflit avec le reste actualisé.
- Seul l'acheteur peut passer une part à `RÉGLÉE`.
- Coût prévu 100 €, prix payé 110 €, participants : A en pourcentage 60 %, B en montant fixe 40 € → A passe à 70 €, B reste à 40 €.
- Coût prévu 100 €, prix payé 110 €, A fixe 30 € puis B fixe 70 € → B passe à 80 €. Si B ramène sa part à 72 €, il reste 8 € à couvrir et la fenêtre CPT-19 s'ouvre pour B.
- Un participant décoché dans la fenêtre CPT-19 ne reçoit aucune notification, par aucun canal.
- Le journal permet de reconstituer l'état de n'importe quel élément à n'importe quelle date.
- Le budget d'un profil n'apparaît dans aucune réponse d'API faite à un autre profil.

## Questions ouvertes

1. Afficher un IBAN ou un lien de paiement (Lydia, Wero, PayPal) sur le profil de l'acheteur : pratique, mais donnée sensible. Reporté.
2. Un organisateur doit-il voir l'état des règlements de tout l'événement ? Défaut : non, chacun ne voit que ce qui le concerne.
