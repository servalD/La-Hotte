/**
 * Jetons de mouvement pour la bibliothèque Motion (MOT-01, MOT-02, MOT-10).
 * Miroir exact des variables de tokens.css (en secondes) ; un test garantit l'égalité.
 * Aucun composant n'écrit une durée ou une courbe : il importe ces jetons ou les variantes partagées.
 */

export const duration = {
  /** Micro-interactions : pression, bascule. */
  micro: 0.12,
  /** Transitions d'éléments : apparition, repli. */
  element: 0.24,
  /** Transitions de page. */
  page: 0.36,
  /** Célébration (réception confirmée) — seul cas au-delà de 500 ms. */
  celebration: 0.6,
} as const;

type CubicBezier = readonly [number, number, number, number];

export const ease = {
  /** Ce qui entre : sortie douce. */
  enter: [0.16, 1, 0.3, 1],
  /** Ce qui sort : entrée douce. */
  exit: [0.7, 0, 0.84, 0],
  standard: [0.2, 0, 0, 1],
} as const satisfies Record<string, CubicBezier>;

/** Ressort léger pour les gestes directs : glisser, tirer, réorganiser. */
export const spring = {
  gesture: { type: 'spring', stiffness: 520, damping: 38, mass: 1 },
} as const;
