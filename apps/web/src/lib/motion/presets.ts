'use client';

import { type Transition, type Variants, useReducedMotion } from 'motion/react';
import { duration, ease } from '@/styles/motion';

/**
 * Variantes partagées (MOT-11). On n'anime que `transform` et `opacity` (MOT-03).
 * Avec `prefers-reduced-motion`, déplacements et mises à l'échelle deviennent des fondus courts (MOT-04).
 */
const full = {
  /** Un élément qui apparaît : monte légèrement en se révélant. */
  appear: {
    hidden: { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0, transition: { duration: duration.element, ease: ease.enter } },
    exit: { opacity: 0, y: 4, transition: { duration: duration.micro, ease: ease.exit } },
  },
  /** Nouveau contenu arrivé en direct : glisse depuis le bas. */
  arriveFromBelow: {
    hidden: { opacity: 0, y: 24 },
    visible: { opacity: 1, y: 0, transition: { duration: duration.element, ease: ease.enter } },
    exit: { opacity: 0, transition: { duration: duration.micro, ease: ease.exit } },
  },
  /** Confirmation d'un geste : léger rebond d'échelle. */
  confirm: {
    hidden: { opacity: 0, scale: 0.92 },
    visible: { opacity: 1, scale: 1, transition: { duration: duration.element, ease: ease.enter } },
    exit: { opacity: 0, transition: { duration: duration.micro, ease: ease.exit } },
  },
} satisfies Record<string, Variants>;

const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.micro } },
  exit: { opacity: 0, transition: { duration: duration.micro } },
};

export type MotionPreset = keyof typeof full;

/** Hook commun : renvoie la variante adaptée aux préférences de l'utilisateur. */
export function useMotionPreset(preset: MotionPreset): Variants {
  const reduced = useReducedMotion();
  return reduced ? fade : full[preset];
}

/** Transition de micro-interaction, pour `whileTap` et les bascules. */
export function useMicroTransition(): Transition {
  const reduced = useReducedMotion();
  return reduced ? { duration: 0 } : { duration: duration.micro, ease: ease.standard };
}
