# 06 — Commentaires, notifications et temps réel

## Objectif

Permettre de discuter autour d'un élément comme sur un ticket, et tenir chacun informé à la seconde, sans jamais prévenir la mauvaise personne.

## Commentaires

- **COM-01** Chaque élément de liste (souhait ou cadeau) a **deux fils** :

| Fil | Qui lit et écrit | Usage |
|---|---|---|
| **Public** | Tous ceux qui voient l'élément, destinataire compris | « Quelle taille ? », « Plutôt en bleu » |
| **Offreurs** | Ceux qui voient l'élément, **sauf** les destinataires | « Je prends, qui partage ? », « Commandé, livraison le 18 » |

- **COM-02** Pour un offreur, les deux fils sont présentés dans la même colonne, avec un sélecteur bien visible et une couleur de fond distincte. Le champ de saisie rappelle en permanence qui lira : « Visible de Léa » ou « Léa ne verra pas ce message ». Le fil par défaut à l'ouverture est **Offreurs**.
- **COM-03** Pour un destinataire, le second fil n'existe pas : ni onglet, ni compteur.
- **COM-04** Sur une giftlist, seul le fil Offreurs existe tant que l'élément n'est pas montré au destinataire.
- **COM-05** Un commentaire : texte brut avec mise en forme légère (gras, italique, liens, listes), 2 000 caractères, mentions `@profil` limitées aux profils qui peuvent lire le fil, une image jointe au plus.
- **COM-06** Modification pendant 15 minutes par l'auteur, avec mention « modifié ». Suppression par l'auteur ou par le créateur de la liste ; il reste « message supprimé ».
- **COM-07** Le fil mêle commentaires et **événements d'activité** générés par le système, à la manière d'un ticket : « Paul a réservé », « Prix modifié de 49 € à 39 € », « Marie a coché l'achat ». Les événements d'activité liés aux offreurs n'apparaissent que dans le fil Offreurs.
- **COM-08** Réactions par émoji sur un commentaire. Pas de réponses imbriquées en v1 : fil chronologique simple.
- **COM-09** Le contenu est échappé à l'affichage. Les liens s'ouvrent dans un nouvel onglet avec `rel="noopener noreferrer"`. Aucun HTML utilisateur n'est rendu.
- **COM-10** Signalement d'un commentaire possible par tout lecteur (voir `11-admin-rbac.md`).

## Notifications

- **NOT-01** Trois canaux : dans l'application (centre de notifications, temps réel), push (application installée), e-mail (résumé).
- **NOT-02** Événements notifiés et canal par défaut :

| Événement | Destinataires de la notification | In-app | Push | E-mail |
|---|---|---|---|---|
| Invitation à un événement ou à une liste | L'invité | ✔ | ✔ | ✔ |
| Demande de lien | Le profil visé | ✔ | ✔ | ✔ |
| Nouveau commentaire sur un élément suivi | Les lecteurs du fil qui le suivent | ✔ | ✔ | Résumé |
| Mention `@` | Le profil mentionné | ✔ | ✔ | ✔ |
| Quelqu'un rejoint un cadeau où je participe | Les participants | ✔ | ✔ | — |
| L'acheteur a coché l'achat | Les participants | ✔ | ✔ | — |
| Ma part a été marquée réglée | Le participant | ✔ | — | — |
| Rappel de part à régler | Le participant | ✔ | ✔ | Résumé |
| Un souhait réservé a été retiré ou modifié | Les offreurs engagés | ✔ | ✔ | ✔ |
| Le prix d'un élément où je participe a changé | Les participants | ✔ | ✔ | — |
| Rappel d'événement (J-14, J-3) | Les invités sans réponse, les offreurs sans réservation | ✔ | ✔ | ✔ |
| Extraction d'article terminée | L'auteur | ✔ | — | — |
| PIN réinitialisé, nouvelle connexion, TOTP modifié | Le profil ou le compte concerné | ✔ | ✔ | ✔ |

- **NOT-03** On suit automatiquement un élément quand on le crée, le commente, le réserve ou y participe. On peut se désabonner élément par élément.
- **NOT-04** Préférences par profil, par canal et par catégorie. Les notifications de sécurité ne sont pas désactivables.
- **NOT-05** **Aucune notification ne franchit la règle de surprise.** Chaque notification est produite pour un destinataire donné après passage par le moteur de visibilité. Un destinataire de cadeau ne reçoit rien qui trahisse l'activité des offreurs, y compris par le libellé, le compteur ou l'heure d'envoi.
- **NOT-06** **Appareil partagé.** Le texte d'une notification push ne contient jamais le nom d'un article ni d'un destinataire quand elle concerne une activité d'offreur : « Du nouveau sur un cadeau que vous préparez ». Le détail s'affiche après ouverture, sous le bon profil (et son PIN). Réglage par profil pour afficher le détail si l'appareil est personnel.
- **NOT-07** Les push sont adressées à un profil sur un appareil. Sur un appareil où plusieurs profils d'un compte sont utilisés, la notification indique à quel profil elle s'adresse, sans détail.
- **NOT-08** E-mail : un résumé quotidien au plus, regroupé, envoyé à l'adresse du compte. Comme la boîte est partagée par la famille, le résumé applique NOT-06 : aucun détail d'activité d'offreur.
- **NOT-09** Heures calmes par profil (défaut 21 h à 8 h, heure locale) : pas de push, les notifications attendent.

## Temps réel

- **RT-01** Connexion WebSocket authentifiée par le cookie de session, liée au profil actif. Changer de profil ferme et rouvre la connexion.
- **RT-02** Le client s'abonne à des **salons** : `profil:{id}` (ses notifications), `liste:{id}`, `élément:{id}`, `événement:{id}`. Le serveur vérifie le droit d'accès à chaque abonnement et le revérifie quand les droits changent.
- **RT-03** Les salons d'offreurs et de destinataires sont **distincts** (`élément:{id}:offreurs`, `élément:{id}:public`). Un destinataire ne peut pas s'abonner au premier. C'est une seconde barrière, en plus du filtrage par message.
- **RT-04** Un message temps réel transporte un type d'événement et un identifiant, et la donnée déjà filtrée pour ce salon. En cas de doute, il ne transporte que l'identifiant et le client recharge par l'API.
- **RT-05** Indicateurs de présence (« Paul regarde cet élément ») et de saisie : uniquement dans le fil Offreurs, désactivables.
- **RT-06** À la reconnexion, le client demande les événements manqués depuis son dernier numéro de séquence ; au-delà d'un seuil, il recharge les données.
- **RT-07** Perte d'accès (lien rompu, retrait de l'audience, règle modifiée) : le serveur désabonne immédiatement et envoie un événement qui purge les données correspondantes du cache local.

## Critères d'acceptation

- Un client connecté comme destinataire qui tente de rejoindre un salon d'offreurs est refusé, et la tentative est journalisée.
- Un commentaire posté dans le fil Offreurs apparaît en moins d'une seconde chez les autres offreurs connectés, et jamais dans les trames reçues par le destinataire.
- Une notification push d'activité d'offreur ne contient aucun nom d'article ni de personne par défaut.
- Après retrait d'un profil de l'audience, ses écrans ouverts cessent de recevoir les mises à jour et l'élément disparaît.

## Questions ouvertes

1. Réponses imbriquées dans les fils : reportées, à réévaluer selon l'usage.
2. Résumé e-mail : quotidien ou hebdomadaire par défaut ?
