# 10 — Expérience utilisateur et motion design

## Objectif

Le produit a beaucoup de règles ; l'utilisateur ne doit en voir aucune tant qu'il n'en a pas besoin. Ce document fixe comment la complexité est cachée, et comment le mouvement aide à comprendre.

## Principes de simplicité

- **UX-01 Une action principale par écran.** Liste : « Ajouter ». Souhait d'un proche : « Je l'offre ». Panier : « Acheté ».
- **UX-02 Les défauts font le travail.** Créer une liste, ajouter un souhait, répondre à une invitation et réserver un cadeau se font sans ouvrir un seul réglage.
- **UX-03 Divulgation progressive.** Visibilité, parts, exposition d'une giftlist : repliées sous « Options », avec un résumé en une ligne de l'état courant (« Visible de tous les invités »).
- **UX-04 Toujours dire qui voit.** Tout écran où l'on écrit ou règle quelque chose affiche en clair qui le verra. C'est la parade à l'erreur la plus grave du produit.
- **UX-05 Trois gestes au plus** pour les parcours clés (voir ci-dessous).
- **UX-06 Jamais d'impasse.** Chaque état vide propose l'action suivante. Chaque erreur dit quoi faire.
- **UX-07 Annuler plutôt que confirmer.** Les actions réversibles s'exécutent tout de suite avec un « Annuler » pendant quelques secondes. Les fenêtres de confirmation sont réservées à l'irréversible et à ce qui peut révéler une surprise.
- **UX-08 Vocabulaire.** Uniquement les termes du glossaire, tournés vers l'utilisateur : « Je l'offre », « Participer », « Ma part », « Qui voit ça ? ». Jamais « whitelist », « blacklist », « RBAC », « synchronisation ».

## Parcours clés

| Parcours                                     | Gestes | Détail                                                               |
| -------------------------------------------- | ------ | -------------------------------------------------------------------- |
| Ajouter un souhait depuis un site            | 2      | Partager → Wishlist ; valider la fiche                               |
| Répondre à une invitation et avoir une liste | 3      | Ouvrir l'invitation ; « Je participe » ; valider les souhaits repris |
| Offrir un souhait en entier                  | 1      | « Je l'offre » (annulable)                                           |
| Participer à un cadeau commun                | 3      | « Participer » ; choisir montant ou pourcentage ; valider            |
| Cacher un souhait à quelqu'un                | 3      | Options ; « Qui voit ça ? » ; cocher la personne                     |
| Pointer un remboursement                     | 1      | Cocher la part dans le panier                                        |

## Navigation

- **UX-10** Quatre entrées : **Accueil** (ce qui demande mon attention : invitations, parts à régler, événements proches), **Listes** (les miennes, celles de mes proches), **Événements**, **Panier & comptes**. Notifications et changement de profil dans l'en-tête.
- **UX-11** L'accueil d'un nouveau profil est un parcours guidé de trois cartes : ajouter un premier souhait, inviter un proche, installer l'application. Aucune visite guidée imposée.
- **UX-12** Sélecteur de profil : avatars en grand, à la manière d'un écran d'accueil familial ; cadenas sur les profils à PIN.

## Sélecteur « Qui voit ça ? »

Composant unique, réutilisé pour les éléments, les listes et la fenêtre de publication (REP-06).

- **UX-20** Trois choix : « Tout le monde » (défaut) · « Seulement… » · « Tout le monde sauf… ».
- **UX-21** Les deux derniers ouvrent la liste des profils concernés, avec avatars, recherche et sélection multiple.
- **UX-22** Sous le sélecteur, un résumé vivant : « Visible de 7 personnes. Cachée à Léa et Tom. »
- **UX-23** Une ligne d'aide explique la différence quand une personne rejoint plus tard (VIS-15).
- **UX-24** Si le composant est en lecture seule (droit absent, LST-03), il affiche qui peut modifier.

## États et retours

- **UX-30** Codes de couleur des éléments, toujours doublés d'une icône et d'un libellé. **Vue offreur** : neutre = ouvert ; ambre = réservé en partie ; violet = réservé en entier ; **bleu = acheté, supposé reçu** ; **vert = reçu confirmé**. **Vue destinataire** : neutre, ou vert quand il a coché « reçu » ; rien d'autre (LST-16).
- **UX-31** Chargements : squelettes à la forme du contenu, jamais d'écran blanc ni de roue bloquante.
- **UX-32** Mises à jour optimistes : l'interface réagit tout de suite ; un état « en attente » discret distingue ce qui n'est pas encore confirmé par le serveur (OFF-13).
- **UX-33** Hors ligne : bandeau fin et non bloquant ; les actions indisponibles sont grisées avec la raison au toucher.

## Motion design

Le mouvement sert à trois choses : **situer** (d'où vient cet écran), **confirmer** (mon geste a été pris en compte), **attirer l'œil** (quelque chose vient de changer). Jamais décoratif au détriment de la vitesse.

### Règles

- **MOT-01** Durées : 120 ms micro-interactions, 200 à 280 ms transitions d'éléments, 320 à 400 ms transitions de page. Rien au-dessus de 500 ms sauf célébration.
- **MOT-02** Courbes : sortie douce pour ce qui entre, entrée douce pour ce qui sort, ressort léger pour les gestes directs (glisser, tirer). Valeurs définies comme jetons du système de design, jamais écrites en dur dans un composant.
- **MOT-03** On n'anime que `transform` et `opacity`. Objectif 60 images par seconde sur un téléphone d'entrée de gamme.
- **MOT-04** `prefers-reduced-motion` : les déplacements et mises à l'échelle deviennent des fondus courts ; les célébrations sont supprimées. Aucune information ne dépend d'une animation.
- **MOT-05** Une animation n'empêche jamais d'agir : tout est interruptible.

### Moments animés

| Moment                                   | Animation                                                                                                      | Rôle                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Ouverture d'un élément                   | La carte s'agrandit jusqu'à devenir la page (élément partagé)                                                  | Situer                                          |
| Fiche en cours d'analyse                 | Squelette scintillant, puis les champs se posent un à un (image, titre, prix)                                  | Montrer que l'IA travaille, puis qu'elle a fini |
| « Je l'offre »                           | Le bouton se transforme en état « Réservé », un ruban se noue sur la carte                                     | Confirmer                                       |
| Participation ajoutée                    | Le montant « vole » vers la vue latérale, la jauge de budget avance, le total s'incrémente chiffre par chiffre | Relier l'action à son effet sur le budget       |
| Jauge de financement                     | Remplissage fluide ; à 100 %, bref éclat                                                                       | Confirmer                                       |
| Achat coché                              | Coche dessinée, la ligne passe au bleu et glisse dans « Achetés »                                              | Confirmer et situer                             |
| Part réglée                              | Coche, la ligne se replie                                                                                      | Confirmer                                       |
| Réception confirmée                      | Côté destinataire : la carte passe au vert, confettis discrets. Côté offreurs : passage du bleu au vert        | Célébrer                                        |
| Nouveau commentaire en direct            | Glisse depuis le bas, surbrillance qui s'estompe                                                               | Attirer l'œil                                   |
| Élément mis à jour par quelqu'un d'autre | Halo bref sur le champ modifié                                                                                 | Attirer l'œil                                   |
| Réorganisation de liste                  | Les éléments s'écartent sous le doigt, ressort au lâcher                                                       | Geste direct                                    |
| Changement de profil                     | Fondu enchaîné aux couleurs du profil                                                                          | Situer, marquer le changement de contexte       |
| Tiroirs et panneaux                      | Suivent le doigt, se referment par glissement                                                                  | Geste direct                                    |

### Mise en œuvre

- **MOT-10** Bibliothèque Motion pour React ; transitions de page par l'API View Transitions quand le navigateur la propose, fondu simple sinon.
- **MOT-11** Les animations sont des composants et variantes partagés du système de design, pas du code par écran.
- **MOT-12** Retour haptique léger sur mobile pour réserver, cocher l'achat et confirmer la réception, là où l'appareil le permet.

## Système de design

- **DS-01** Jetons : couleurs (thèmes clair et sombre), typographie, espacements, rayons, ombres, durées et courbes d'animation.
- **DS-02** Composants de base accessibles (shadcn/ui sur Radix), stylés par Tailwind à partir des jetons.
- **DS-03** Chaque profil choisit une couleur d'accent, utilisée pour son avatar et pour marquer « je suis sous ce profil ».
- **DS-04** Ton chaleureux et sobre : illustrations légères pour les états vides, pas de surcharge festive permanente.

## Accessibilité

- **A11Y-01** WCAG 2.1 niveau AA.
- **A11Y-02** Tout est utilisable au clavier ; ordre de tabulation logique ; focus visible ; les fenêtres et tiroirs retiennent le focus et le rendent à la fermeture.
- **A11Y-03** Contrastes 4,5:1 pour le texte, 3:1 pour les éléments d'interface. La couleur n'est jamais le seul porteur d'information (UX-30).
- **A11Y-04** Les mises à jour en direct sont annoncées aux lecteurs d'écran par des régions vivantes polies, sans voler le focus.
- **A11Y-05** Le glisser-déposer a une alternative par menu (« Monter », « Descendre »).
- **A11Y-06** Textes agrandis à 200 % sans perte de contenu.

## Langues

- **I18N-01** Français par défaut, anglais prêt. Aucun texte en dur dans les composants.
- **I18N-02** Montants, dates et pluriels formatés selon la langue du profil.

## Critères d'acceptation

- Chaque parcours clé est réalisable dans le nombre de gestes annoncé, vérifié par un test de bout en bout.
- Avec `prefers-reduced-motion`, aucun déplacement n'est joué.
- Audit d'accessibilité automatisé sans erreur sur les écrans principaux, complété d'une passe manuelle au lecteur d'écran sur les parcours clés.
- Test avec cinq personnes non techniciennes : chacune ajoute un souhait et en réserve un sans aide.

## Questions ouvertes

1. Identité visuelle (nom, logo, palette) : à définir avant la phase d'interface.
2. Thème saisonnier optionnel (Noël) : agréable, mais à garder désactivable.
