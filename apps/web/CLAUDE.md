# apps/web — Next.js (PWA)

Spec : `docs/spec/10` (UX, motion, accessibilité), `08` (hors ligne, installation), `06` (temps réel côté client). Décision : `docs/adr/0005`.

## Organisation

```
src/app/            routes (App Router)
src/features/<x>/   écrans, composants et hooks d'un domaine
src/components/ui/  composants de base du système de design
src/lib/            données, hors ligne, temps réel, i18n
src/styles/         jetons (couleurs, espacements, durées, courbes)
```

## Commandes (dans `apps/web`)

`pnpm dev` (port 3000, `/api/*` relayé vers `API_ORIGIN`, par défaut `http://localhost:4000`), `pnpm test`, `pnpm build`, `pnpm test:e2e` (après `pnpm build` ; `pnpm exec playwright install chromium` la première fois).

## Socle en place

- **Jetons** : `src/styles/tokens.css` (variables `--ds-*`, thèmes clair et sombre), exposés à Tailwind dans `src/app/globals.css` (`bg-surface`, `text-foreground-muted`, `min-h-touch`, `ease-enter`…). Ajouter un jeton : dans `tokens.css`, puis dans `@theme inline`.
- **Motion** : `src/styles/motion.ts` (durées, courbes, ressort), miroir de `tokens.css` vérifié par un test ; variantes partagées et hook `useMotionPreset` dans `src/lib/motion/presets.ts`. `MotionConfig reducedMotion="user"` est posé globalement.
- **Thème** : `next-themes`, attribut `data-theme`.
- **i18n** : next-intl sans préfixe d'URL ; langue lue dans le cookie `locale` (phase 1 : langue du profil). Messages dans `messages/fr.json` et `en.json` ; un test exige les mêmes clés.
- **Composants** : `src/components/ui` (Button, Input, Label, Card, Skeleton, Dialog), à la manière de shadcn, sur `radix-ui`.
- **Sécurité** : CSP à nonce posée par `src/middleware.ts` (SEC-13), autres en-têtes dans `next.config.ts`.
- **Écran d'essai** : `src/features/example` (formulaire → Zod généré → hook généré → relecture polymorphe). À supprimer avec le module `example` de l'API.
- Le lint interdit `fetch`, `localStorage`, `sessionStorage` et `dangerouslySetInnerHTML` dans `src`.

## Règles

- **Données** : uniquement par les hooks de `@wishlist/api-client`. Pas de `fetch` écrit à la main, pas de type d'API redéfini.
- **Composants serveur par défaut** ; `"use client"` seulement pour l'interactif. Les données propres à un profil ne sont jamais mises en cache côté serveur de façon partagée.
- **Aucune règle d'accès dans le client.** L'interface affiche ce que l'API renvoie ; elle ne masque pas une donnée reçue. Si une donnée ne doit pas être vue, c'est l'API qu'il faut corriger.
- **Formulaires** : validés avec les schémas Zod générés ; le serveur reste l'autorité, ses erreurs sont affichées par champ.
- **Textes** : aucun texte en dur, tout passe par next-intl. Vocabulaire du glossaire ; jamais « whitelist », « blacklist », « synchronisation ».
- **Toujours dire qui voit** : tout écran de saisie ou de réglage affiche qui lira (UX-04).
- **Contenu utilisateur** : jamais de `dangerouslySetInnerHTML`. Liens externes avec `rel="noopener noreferrer"`.
- **Erreurs et télémétrie** : `@sentry/nextjs` en erreurs seulement (pas de traces ni de replay navigateur), envoyées par le relais `/monitoring` de notre origine (OBS-33), sans contexte utilisateur ni corps de requête (OBS-20, OBS-21). Aucune source map servie au navigateur (OBS-30).

## Hors ligne

- Persistance TanStack Query en IndexedDB, **une base par profil** ; fermée au changement de profil, effacée à la déconnexion.
- Mutations hors ligne par la file prévue, avec clé d'idempotence. Ne pas créer d'autre mécanisme de mise en attente.
- Une réservation ou participation non confirmée s'affiche « à confirmer » (OFF-13).
- Actions exigeant le réseau (OFF-10) : grisées, avec la raison.
- Rien de sensible dans `localStorage` ni `sessionStorage`.
- Le service worker ne met pas en cache les réponses d'API.

## Temps réel

- Un seul client Socket.IO, lié au profil actif, recréé au changement de profil.
- Les événements invalident ou mettent à jour le cache des hooks ; pas d'état parallèle.
- Sur `access.revoked`, purger les données concernées.

## Motion

- Bibliothèque Motion ; variantes et durées partagées issues des jetons. Pas de durée ni de courbe en dur.
- Animer seulement `transform` et `opacity`.
- Respecter `prefers-reduced-motion` par le hook commun.
- Une animation ne bloque jamais une action et ne porte jamais seule une information.

## Accessibilité

- WCAG 2.1 AA. Composants Radix / shadcn pour tout ce qui est interactif.
- Clavier complet, focus visible, focus rendu à la fermeture des fenêtres.
- Couleur toujours doublée d'une icône et d'un libellé (états bleu et vert notamment).
- Zones tactiles ≥ 44 px ; alternative par menu à tout glisser-déposer.

## Tests

- Composants : Vitest + Testing Library.
- Parcours clés, hors ligne, multi-profils : Playwright, bureau et mobile émulé, avec contrôle axe.

## Modèle

Sonnet 5.5 par défaut. Opus 5.5 pour le cache cloisonné et chiffré, la file de mutations et la gestion de session.
