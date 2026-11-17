'use client';

import {
  animate,
  AnimatePresence,
  motion,
  type PanInfo,
  useMotionValue,
  useReducedMotion,
} from 'motion/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { duration, ease, spring } from '@/styles/motion';
import { useMotionPreset } from './presets';

/**
 * Moments animés de `10` (MOT-01 à MOT-12), en composants partagés (MOT-11). Seuls `transform` et
 * `opacity` bougent (MOT-03) ; avec `prefers-reduced-motion`, déplacements et échelles deviennent
 * des fondus courts et les célébrations disparaissent (MOT-04) ; aucune information ne dépend
 * d'une animation, et rien n'empêche d'agir (MOT-05).
 */

/** MOT-12 : retour haptique léger (réserver, cocher l'achat, confirmer la réception). */
export function haptic(): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(10);
}

/**
 * CPT-43, « Participation ajoutée » : le total s'incrémente jusqu'à sa nouvelle valeur. Le texte
 * final est toujours celui rendu ; seule la transition est animée.
 */
export function AnimatedAmount({
  value,
  format,
  className,
}: {
  value: number;
  format: (value: number) => string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const shown = useMotionValue(value);
  const [text, setText] = useState(() => format(value));
  const first = useRef(true);
  // Le formateur change à chaque rendu chez l'appelant ; seule la valeur relance l'animation.
  const formatRef = useRef(format);
  useEffect(() => {
    formatRef.current = format;
  });
  useEffect(() => {
    const format = formatRef.current;
    if (first.current || reduced) {
      first.current = false;
      shown.set(value);
      setText(format(value));
      return undefined;
    }
    const controls = animate(shown, value, {
      duration: duration.element,
      ease: ease.enter,
      onUpdate: (v) => {
        setText(format(Math.round(v)));
      },
    });
    return () => {
      controls.stop();
    };
  }, [value, reduced, shown]);
  return <span className={cn('tabular-nums', className)}>{text}</span>;
}

/** « Jauge de financement » : remplissage fluide ; à 100 %, bref éclat (MOT-01, MOT-03). */
export function FundingGauge({
  covered,
  total,
  label,
}: {
  covered: number;
  total: number | null;
  label: string;
}) {
  const reduced = useReducedMotion();
  const ratio = total && total > 0 ? Math.min(1, covered / total) : 0;
  const full = ratio >= 1;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      className="relative h-2 w-full overflow-hidden rounded-full bg-surface-muted"
    >
      <motion.div
        className="absolute inset-0 origin-left rounded-full bg-primary"
        initial={false}
        animate={{ scaleX: ratio }}
        transition={reduced ? { duration: 0 } : { duration: duration.element, ease: ease.enter }}
      />
      <AnimatePresence>
        {full && !reduced ? (
          <motion.div
            key="eclat"
            aria-hidden="true"
            className="absolute inset-0 bg-surface"
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 0 }}
            transition={{ duration: duration.page, ease: ease.exit }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * « Élément mis à jour par quelqu'un d'autre » : halo bref quand `trigger` change (pas au premier
 * affichage). Le halo est une couche par-dessus, en opacité seulement.
 */
export function Highlight({
  trigger,
  children,
  className,
}: {
  trigger: unknown;
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [pulse, setPulse] = useState(0);
  const previous = useRef(trigger);
  useEffect(() => {
    if (Object.is(previous.current, trigger)) return undefined;
    previous.current = trigger;
    // Le halo est déclenché après le rendu qui a reçu la nouvelle valeur.
    const timer = setTimeout(() => {
      setPulse((p) => p + 1);
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [trigger]);
  return (
    <div className={cn('relative', className)}>
      {children}
      {pulse > 0 ? (
        <motion.div
          key={pulse}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-primary"
          initial={{ opacity: reduced ? 0.4 : 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: reduced ? duration.micro : duration.page, ease: ease.exit }}
        />
      ) : null}
    </div>
  );
}

/** « Je l'offre », « Achat coché » : l'état nouveau se pose avec un léger rebond (confirmer). */
export function Confirmed({ stateKey, children }: { stateKey: string; children: ReactNode }) {
  const variants = useMotionPreset('confirm');
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={stateKey}
        variants={variants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="inline-block"
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}

/** Nouveau contenu en direct (commentaire) : glisse depuis le bas. */
export function ArriveFromBelow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const variants = useMotionPreset('arriveFromBelow');
  return (
    <motion.div variants={variants} initial="hidden" animate="visible" className={className}>
      {children}
    </motion.div>
  );
}

const CONFETTI = Array.from({ length: 12 }, (_, i) => i);

/**
 * « Réception confirmée » côté destinataire : confettis discrets. Célébration : seul cas au-delà
 * de 500 ms (MOT-01), supprimée en mouvement réduit (MOT-04).
 */
export function Celebration({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  if (!active || reduced) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-visible">
      {CONFETTI.map((i) => {
        const angle = (i / CONFETTI.length) * Math.PI * 2;
        return (
          <motion.span
            key={i}
            className={cn(
              'absolute top-1/2 left-1/2 size-2 rounded-sm',
              i % 3 === 0 ? 'bg-success' : i % 3 === 1 ? 'bg-primary' : 'bg-border-strong',
            )}
            initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            animate={{
              opacity: 0,
              x: Math.cos(angle) * 48,
              y: Math.sin(angle) * 48 - 12,
              scale: 0.6,
              rotate: i * 30,
            }}
            transition={{ duration: duration.celebration, ease: ease.enter }}
          />
        );
      })}
    </div>
  );
}

/**
 * « Tiroirs et panneaux » : suivent le doigt, se referment par glissement (ressort léger,
 * MOT-02). Un bouton de fermeture double toujours le geste (PWA-11).
 */
export function DragToClose({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const reduced = useReducedMotion();
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 96 || info.velocity.y > 600) onClose();
  };
  if (reduced) return <>{children}</>;
  return (
    <motion.div
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.6 }}
      dragTransition={{
        bounceStiffness: spring.gesture.stiffness,
        bounceDamping: spring.gesture.damping,
      }}
      onDragEnd={onDragEnd}
      className="touch-pan-x"
    >
      <div aria-hidden="true" className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-border-strong" />
      {children}
    </motion.div>
  );
}
