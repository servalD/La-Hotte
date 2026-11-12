/**
 * Valeurs d'étiquette : des codes et des énumérations, jamais un contenu, un identifiant de
 * profil ni une URL (OBS-20, OBS-21). Une étiquette à forte cardinalité est aussi une fuite.
 */
export type MetricAttributes = Readonly<Record<string, string | number | boolean>>;

/**
 * Port de métriques (OBS-02). Les cas d'usage comptent par ce port, jamais en important la
 * bibliothèque de télémétrie. Noms en `snake_case` préfixés `wishlist.` (`wishlist.domain_errors`).
 */
export abstract class Metrics {
  /** Compteur monotone. */
  abstract increment(name: string, attributes?: MetricAttributes): void;
  /** Distribution (durée, taille, coût). */
  abstract record(name: string, value: number, attributes?: MetricAttributes): void;
}
