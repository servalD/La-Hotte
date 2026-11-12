# ADR 0007 — Extraction d'articles

**Statut :** accepté · 2026-11-11

## Contexte

Transformer un lien quelconque ou une photo en fiche article. Les pages sont hostiles par nature (contenu non fiable, sites qui bloquent les robots) et l'URL vient de l'utilisateur.

## Décision

Chaîne asynchrone en file BullMQ :

1. **Normalisation** de l'URL, consultation du cache (24 h).
2. **Récupération** par le service `fetcher`, isolé, avec les protections EXT-40 à EXT-45.
3. **Données structurées** : JSON-LD `Product`, microdonnées, OpenGraph. Si la fiche est complète, on s'arrête : aucun appel au modèle.
4. **Modèle** sinon : **Claude Haiku 5.5** (`claude-haiku-5-5`) par `@anthropic-ai/sdk`, sortie structurée (`output_config.format`, schéma JSON), sans outil. Pour une photo : même modèle, entrée image.
5. **Validation** de la sortie par schéma puis règles métier ; **brouillon** soumis à l'utilisateur.
6. **Image** téléchargée par `fetcher`, réencodée, stockée chez nous.

Le fournisseur de modèle est derrière un port du domaine (`ProductExtractor`).

## Raisons

- Les données structurées sont gratuites, rapides et fiables quand elles existent : le modèle n'intervient que sur le reste.
- Haiku 5.5 suffit pour une extraction à schéma fixe et coûte peu (0,10 $ / 0,50 $ par million de jetons en entrée / sortie au 2026-11-03) : une page nettoyée de quelques milliers de jetons revient à une fraction de centime.
- Sortie structurée + absence d'outil + brouillon confirmé : une page piégée ne peut au pire que proposer une fiche fausse.

## Conséquences

- Si le modèle refuse (`stop_reason: "refusal"`) ou renvoie une sortie invalide : brouillon à compléter à la main. Haiku 5.5 n'a pas de repli côté serveur ; on ne bascule pas automatiquement sur un autre modèle.
- Qualité à mesurer : jeu de pages figées et taux de champs corrects suivi (`14`). Si Haiku se révèle insuffisant sur certains sites, passer à Sonnet 5.5 est un changement de configuration.
- Les sites à protection anti-robots forte échoueront ; le parcours manuel doit rester agréable (EXT-05).
- Budget quotidien plafonné et alerté (OBS-05) ; plafonds par profil (EXT-34).
- Anthropic est sous-traitant : seuls des contenus de pages publiques et des photos d'articles sans métadonnées sont envoyés (EXT-33, RGPD-03).

## Alternatives écartées

Navigateur sans tête pour exécuter le JavaScript des pages (lourd, surface d'attaque accrue ; à reconsidérer pour une liste blanche de sites) ; API d'extraction tierce (coût et dépendance) ; outil de recherche ou de récupération web du modèle (on perdrait la maîtrise des protections SSRF et du cache) ; analyseurs écrits site par site (fragiles).
