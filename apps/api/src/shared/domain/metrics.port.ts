import type { DomainErrorKind } from './domain-error';

/**
 * OBS-02, OBS-20 : noms de métriques en **liste fermée**. Un nom n'est jamais construit à partir
 * d'un contenu ; en ajouter un passe par cette liste, en revue. Noms en `snake_case` préfixés
 * `wishlist.`. L'adaptateur ignore à l'exécution un nom hors liste.
 */
export const COUNTER_NAMES = [
  'wishlist.domain_errors',
  // AUTH-02 : vérification des fuites sans réponse, mot de passe accepté sans elle.
  'wishlist.password_breach_check_unavailable',
] as const;
export type CounterName = (typeof COUNTER_NAMES)[number];

/**
 * Distributions (durée, taille, coût d'extraction). Aucune pour l'instant. **Une valeur mesurée
 * n'est jamais un montant de part ni de participation** : un histogramme exporte sa somme, son
 * minimum et son maximum, donc le montant exact.
 */
export const HISTOGRAM_NAMES = [] as const;
export type HistogramName = (typeof HISTOGRAM_NAMES)[number];

/**
 * Étiquettes, en liste blanche (OBS-20) : seulement ces clés, et des valeurs de forme fermée, jamais
 * un contenu, un identifiant de profil, une URL ni un nombre (un montant aurait la forme d'un
 * nombre). L'adaptateur retire à l'exécution toute autre clé ou valeur
 * (`platform/telemetry/scrub.ts`, `portMetricAttributes`).
 */
export type MetricAttributes = Readonly<{
  /** Code stable d'une erreur métier, `SCREAMING_SNAKE_CASE` (API-14). */
  code?: string;
  /** Nature d'une erreur métier. */
  kind?: DomainErrorKind;
}>;

/**
 * Port de métriques (OBS-02). Les cas d'usage comptent par ce port, jamais en important la
 * bibliothèque de télémétrie.
 */
export abstract class Metrics {
  /** Compteur monotone. */
  abstract increment(name: CounterName, attributes?: MetricAttributes): void;
  /** Distribution (durée, taille, coût), jamais un montant de part ou de participation. */
  abstract record(name: HistogramName, value: number, attributes?: MetricAttributes): void;
}
