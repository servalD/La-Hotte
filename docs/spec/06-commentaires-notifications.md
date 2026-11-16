# 06 — Commentaires, notifications et temps réel

## Objectif

Permettre de discuter autour d'un élément comme sur un ticket, et tenir chacun informé à la seconde, sans jamais prévenir la mauvaise personne.

## Commentaires

- **COM-01** Chaque élément de liste (souhait ou cadeau) a **deux fils** :

| Fil          | Qui lit et écrit                                      | Usage                                                       |
| ------------ | ----------------------------------------------------- | ----------------------------------------------------------- |
| **Public**   | Tous ceux qui voient l'élément, destinataire compris  | « Quelle taille ? », « Plutôt en bleu »                     |
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
- **COM-11** **Accès aux fils, décidé par le moteur** (VIS-30). Le fil Public se lit par qui voit l'élément, sous une forme ou l'autre ; le fil Offreurs, par qui le voit sous la forme offreur. Écrire suit la lecture, sauf sur une liste archivée ou à la corbeille ; la liste d'un événement clos reste commentable (on se remercie après la fête). Un fil qu'un profil ne lit pas répond `404` à toutes ses routes, comme un élément invisible.
- **COM-12** **Fil Public ouvert** (généralise COM-04). Le fil Public n'existe, pour tous, que si au moins un destinataire de la liste voit l'élément à cet instant : une suggestion (WSH-04), un élément que sa règle cache à tous les destinataires, un élément de giftlist cachée, sans contenu montré ou non montré n'ont que le fil Offreurs. Fermé, il n'est ni lu ni écrit, et rien n'en dit l'existence (ni onglet, ni compteur) ; il rouvre avec ses messages quand l'élément redevient visible d'un destinataire. On n'écrit donc jamais au fil Public d'un élément qu'aucun destinataire ne pouvait lire au moment d'écrire.
- **COM-13** **Mise en forme et mentions.** Texte de 1 à 2 000 caractères après retrait des espaces de bord ; mise en forme légère en Markdown restreint (`**gras**`, `_italique_`, listes `- `, liens `http` et `https` reconnus dans le texte), interprétée par le client sans jamais produire de HTML (COM-09). Les mentions sont transmises à part (`mentionIds`, 10 au plus) ; une mention d'un profil qui ne lit pas le fil est **ignorée sans erreur** (ni notification, ni refus), pour que la réponse n'apprenne pas à l'auteur qui la règle d'un élément écarte. L'image jointe de COM-05 viendra avec la phase 6.
- **COM-14** **Activité.** Entrées écrites par le système, sans texte libre : un code et des valeurs (prix avant et après en unités mineures, devise). En phase 4 : prix modifié, reçu coché ou décoché, retiré par le destinataire (LST-15), montré au destinataire (GFT, fil Offreurs seulement) ; les activités d'engagement (réservé, acheté, part) viennent avec la phase 5. Une activité née du geste d'un destinataire de la liste va au fil Public s'il est ouvert ; née du geste d'un offreur, au fil Offreurs. Elle n'est jamais modifiée ni supprimée.
- **COM-15** **Modification et suppression.** L'auteur modifie son message pendant 15 minutes après sa création (mention « modifié », `editedAt`) ; ni une activité ni un message supprimé ne se modifient. La suppression (auteur, ou autorité de la liste, LST-09) efface le texte et les mentions et retire les réactions ; il reste une ligne « message supprimé ». Un profil supprimé laisse ses messages sans auteur (DAT-06).
- **COM-16** **Réactions.** Six réactions, en liste fermée : `THUMBS_UP`, `HEART`, `LAUGH`, `WOW`, `PARTY`, `THANKS`. Un profil pose au plus une fois chacune sur un message ; pas de réaction sur une activité ni sur un message supprimé.
- **COM-17** **Lecture.** Un fil se lit du plus récent au plus ancien, par pages de 50 au plus (API-15). Le compteur de messages n'existe que pour les fils que le profil lit (COM-03).

## Notifications

- **NOT-01** Trois canaux : dans l'application (centre de notifications, temps réel), push (application installée), e-mail (résumé).
- **NOT-02** Événements notifiés et canal par défaut :

| Événement                                          | Destinataires de la notification                        | In-app | Push | E-mail |
| -------------------------------------------------- | ------------------------------------------------------- | ------ | ---- | ------ |
| Invitation à un événement ou à une liste           | L'invité                                                | ✔      | ✔    | ✔      |
| Demande de lien                                    | Le profil visé                                          | ✔      | ✔    | ✔      |
| Nouveau commentaire sur un élément suivi           | Les lecteurs du fil qui le suivent                      | ✔      | ✔    | Résumé |
| Mention `@`                                        | Le profil mentionné                                     | ✔      | ✔    | ✔      |
| Quelqu'un rejoint un cadeau où je participe        | Les participants                                        | ✔      | ✔    | —      |
| L'acheteur a coché l'achat                         | Les participants                                        | ✔      | ✔    | —      |
| Ma part a été marquée réglée                       | Le participant                                          | ✔      | —    | —      |
| Rappel de part à régler                            | Le participant                                          | ✔      | ✔    | Résumé |
| Un souhait réservé a été retiré ou modifié         | Les offreurs engagés                                    | ✔      | ✔    | ✔      |
| Le prix d'un élément où je participe a changé      | Les participants                                        | ✔      | ✔    | —      |
| Rappel d'événement (J-14, J-3)                     | Les invités sans réponse, les offreurs sans réservation | ✔      | ✔    | ✔      |
| Extraction d'article terminée                      | L'auteur                                                | ✔      | —    | —      |
| PIN réinitialisé, nouvelle connexion, TOTP modifié | Le profil ou le compte concerné                         | ✔      | ✔    | ✔      |

- **NOT-03** On suit automatiquement un élément quand on le crée, le commente, le réserve ou y participe. On peut se désabonner élément par élément.
- **NOT-04** Préférences par profil, par canal et par catégorie. Les notifications de sécurité ne sont pas désactivables.
- **NOT-05** **Aucune notification ne franchit la règle de surprise.** Chaque notification est produite pour un destinataire donné après passage par le moteur de visibilité. Un destinataire de cadeau ne reçoit rien qui trahisse l'activité des offreurs, y compris par le libellé, le compteur ou l'heure d'envoi.
- **NOT-06** **Appareil partagé.** Le texte d'une notification push ne contient jamais le nom d'un article ni d'un destinataire quand elle concerne une activité d'offreur : « Du nouveau sur un cadeau que vous préparez ». Le détail s'affiche après ouverture, sous le bon profil (et son PIN). Réglage par profil pour afficher le détail si l'appareil est personnel.
- **NOT-07** Les push sont adressées à un profil sur un appareil. Sur un appareil où plusieurs profils d'un compte sont utilisés, la notification indique à quel profil elle s'adresse, sans détail.
- **NOT-08** E-mail : un résumé quotidien au plus, regroupé, envoyé à l'adresse du compte. Comme la boîte est partagée par la famille, le résumé applique NOT-06 : aucun détail d'activité d'offreur.
- **NOT-09** Heures calmes par profil (défaut 21 h à 8 h, heure locale) : pas de push, les notifications attendent.
- **NOT-10** **Production par candidat.** Un producteur (commentaire, événement, sécurité…) désigne des profils candidats et un **sujet** : un élément et un fil, une liste, un événement, ou le profil lui-même. Le module `notifications` demande au moteur, pour chaque candidat et au moment de produire, s'il lit ce sujet sous la forme requise (le fil Offreurs exige la forme offreur) ; sinon il ne produit rien pour lui. L'auteur du geste n'est jamais notifié de son propre geste.
- **NOT-11** **Revérification à la lecture.** Une notification ne garde que son type, ses identifiants et des valeurs sans contenu ; titres et noms sont relus à l'affichage, à travers le moteur. Une notification dont le sujet n'est plus visible du profil n'apparaît plus, ni dans le centre, ni dans le compteur (VIS-22), ni dans une push ou un résumé pas encore envoyés.
- **NOT-12** **Catégories** (préférences de NOT-04) et canaux par défaut :

| Catégorie     | Contenu                                                                                         | In-app | Push | E-mail (résumé) |
| ------------- | ----------------------------------------------------------------------------------------------- | ------ | ---- | --------------- |
| `INVITATIONS` | Invitation à un événement (EVT-15), à une liste                                                 | ✔      | ✔    | ✔               |
| `LINKS`       | Demande de lien                                                                                 | ✔      | ✔    | ✔               |
| `COMMENTS`    | Nouveau message sur un élément suivi                                                            | ✔      | ✔    | ✔               |
| `MENTIONS`    | Mention                                                                                         | ✔      | ✔    | ✔               |
| `GIFTS`       | Participations, achat, parts, prix changé d'un cadeau où je participe (phase 5)                 | ✔      | ✔    | —               |
| `ITEMS`       | Souhait réservé retiré ou modifié (LST-15)                                                      | ✔      | ✔    | ✔               |
| `EVENTS`      | Rappels (EVT-13), annulation (EVT-34), lendemain (EVT-32), retrait d'un participant engagé      | ✔      | ✔    | ✔               |
| `EXTRACTION`  | Extraction d'article terminée                                                                   | ✔      | —    | —               |
| `SECURITY`    | PIN réinitialisé, nouvelle connexion, TOTP activé ou désactivé ; non désactivable (NOT-04)      | ✔      | ✔    | ✔               |

  Un message dont le profil est mentionné produit une notification `MENTIONS` et non `COMMENTS`. Les e-mails de sécurité déjà envoyés sur le moment par `identity` (PIN-03, AUTH-06, AUTH-16) le restent ; le résumé ne les répète pas.
- **NOT-13** **Suivi** (NOT-03). On suit d'office un élément qu'on ajoute ou qu'on commente (puis qu'on réserve ou finance, phase 5) ; on cesse de le suivre élément par élément, et on peut le suivre de nouveau. Suivre exige de voir l'élément ; un abonné qui ne le voit plus ne reçoit rien (NOT-10).
- **NOT-14** **Heures calmes.** Début et fin en heure locale du profil (son fuseau), réglables, désactivables ; défaut 21 h à 8 h. Les push d'une notification née pendant les heures calmes partent à leur fin, si elle est encore non lue et visible (NOT-11). L'in-app et le résumé ne sont pas retenus.
- **NOT-15** **Push par appareil et par profil** (NOT-07). Un appareil s'abonne une fois (un point de terminaison) ; chaque profil qui l'active sur cet appareil y est rattaché, avec son réglage « afficher le détail », désactivé par défaut (NOT-06). L'abonnement appartient à la session qui l'a créé : sa déconnexion ou sa révocation le supprime. Le texte d'une push nomme le profil auquel elle s'adresse et, sans détail, seulement sa catégorie (« Pour Léa : du nouveau sur un cadeau que vous préparez »).
- **NOT-16** **Points de terminaison permis.** Le serveur n'envoie une push qu'à un point de terminaison `https` d'un service de push connu (liste fermée : Google, Mozilla, Apple, Microsoft), jamais à une adresse quelconque : sinon `422 PUSH_ENDPOINT_INVALID`. Ni le point de terminaison ni les clés ne sortent dans les journaux ou la télémétrie.
- **NOT-17** **Résumé e-mail** (NOT-08, ancienne question 2). Par défaut **quotidien** ; chaque profil choisit quotidien, hebdomadaire ou aucun. Un seul message par compte et par passage, à l'adresse du compte, regroupant les profils dus : pour chacun, son nom et le nombre de notifications non lues et encore visibles, nées depuis son dernier résumé, dans les catégories où l'e-mail est activé. Ni titre, ni nom d'article, de liste, d'événement ou de personne, ni catégorie : une boîte partagée ne doit rien apprendre d'une activité d'offreur. Rien de nouveau, rien d'envoyé.
- **NOT-18** **Lecture.** Le centre se lit du plus récent au plus ancien (API-15) ; marquer lues une liste de notifications, ou toutes jusqu'à un numéro de séquence. Les notifications de plus de 90 jours sont purgées.

## Temps réel

- **RT-01** Connexion WebSocket authentifiée par le cookie de session, liée au profil actif. Changer de profil ferme et rouvre la connexion.
- **RT-02** Le client s'abonne à des **salons** : `profile:{id}` (ses notifications), `list:{id}`, `item:{id}`, `event:{id}` (noms du protocole, en anglais comme l'API). Le serveur vérifie le droit d'accès à chaque abonnement et le revérifie quand les droits changent.
- **RT-03** Les salons d'offreurs et de destinataires sont **distincts** (`item:{id}:givers`, `item:{id}:public`). Un destinataire ne peut pas s'abonner au premier. C'est une seconde barrière, en plus du filtrage par message.
- **RT-04** Un message temps réel transporte un type d'événement et un identifiant, et la donnée déjà filtrée pour ce salon. En cas de doute, il ne transporte que l'identifiant et le client recharge par l'API.
- **RT-05** Indicateurs de présence (« Paul regarde cet élément ») et de saisie : uniquement dans le fil Offreurs, désactivables.
- **RT-06** À la reconnexion, le client demande les événements manqués depuis son dernier numéro de séquence ; au-delà d'un seuil, il recharge les données.
- **RT-07** Perte d'accès (lien rompu, retrait de l'audience, règle modifiée) : le serveur désabonne immédiatement et envoie un événement qui purge les données correspondantes du cache local.
- **RT-08** **Une trame n'apprend rien de plus que l'API au même instant.** Chaque message est émis socket par socket : la session est revérifiée (ADR 0013, `checkSessionAccess`), puis le moteur décide si ce profil voit, à cet instant, la ressource sous la forme que le message exige (un changement visible des seuls offreurs exige la forme offreur). Un message ne porte que des identifiants et le type de changement, jamais de contenu : le client relit par l'API. Seules la présence et la saisie portent des identifiants de profils, et seulement dans le salon d'offreurs.
- **RT-09** **Salons.** `profile:{id}` : le profil actif de la socket, seulement. `list:{id}` : qui voit la liste. `item:{id}:public` : qui lit le fil Public (COM-11, COM-12). `item:{id}:givers` : qui lit le fil Offreurs. `event:{id}` : qui voit l'événement (VIS-36). Un refus répond `denied`, sans distinguer une ressource invisible d'une ressource inconnue ; un refus du salon d'offreurs d'un élément visible est journalisé (ligne de journal et métrique, sans identifiant de ressource).
- **RT-10** **Revérification.** Un changement de cercle, d'audience, de destinataires, de membres, de règle, de participant ou de réponse fait revérifier les sockets abonnées aux salons concernés ; une révocation de session, un verrouillage de profil ou un changement de profil ferme les sockets de la session. La revérification au moment d'émettre (RT-08) reste la barrière : un retard de désabonnement ne fait rien fuiter.
- **RT-11** **Présence et saisie** (RT-05) : messages éphémères envoyés par le client dans un salon d'offreurs où il est abonné, jamais stockés ; une présence expire sans signe de vie pendant 60 secondes. Chaque profil peut ne pas partager sa présence ni sa saisie (réglage du profil), sans cesser de voir celles des autres.
- **RT-12** **Rattrapage** (RT-06, API-32). Seules les notifications portent un numéro de séquence par profil. À la reconnexion, le client demande `GET /sync?since=` : les notifications plus récentes encore visibles (200 au plus), et `reset: true` au-delà, ou si `since` est plus ancien que la purge ; il recharge ensuite les données des salons qu'il suit, puisque leurs messages ne sont pas rejoués.

## Critères d'acceptation

- Un client connecté comme destinataire qui tente de rejoindre un salon d'offreurs est refusé, et la tentative est journalisée.
- Un commentaire posté dans le fil Offreurs apparaît en moins d'une seconde chez les autres offreurs connectés, et jamais dans les trames reçues par le destinataire.
- Une notification push d'activité d'offreur ne contient aucun nom d'article ni de personne par défaut.
- Après retrait d'un profil de l'audience, ses écrans ouverts cessent de recevoir les mises à jour et l'élément disparaît.
- Un élément de giftlist non montré, une suggestion, un élément caché à tous les destinataires n'ont pas de fil Public : ses routes répondent `404` à tous.
- Une notification dont le sujet devient invisible disparaît du centre et du compteur, et sa push retenue ne part pas.
- Le résumé e-mail ne contient aucun titre ni nom autre que ceux des profils du compte.
- Un point de terminaison push hors des services connus est refusé.

## Valeurs par défaut

| Réglage                         | Valeur                        |
| ------------------------------- | ----------------------------- |
| Modification d'un message       | 15 minutes                    |
| Mentions par message            | 10                            |
| Heures calmes                   | 21 h à 8 h, heure du profil   |
| Résumé e-mail                   | quotidien                     |
| Expiration d'une présence       | 60 secondes                   |
| Rattrapage par `/sync`          | 200 notifications, sinon `reset` |
| Conservation des notifications  | 90 jours                      |
| Abonnements push par profil     | 10 appareils                  |

## Questions ouvertes

1. Réponses imbriquées dans les fils : reportées, à réévaluer selon l'usage.
