import type { ReactNode } from 'react';

/** Illustration légère (DS-04, DS-07) : un paquet-cadeau, aux couleurs des jetons. Décorative. */
export function GiftIllustration() {
  return (
    <svg
      viewBox="0 0 120 96"
      width="120"
      height="96"
      aria-hidden="true"
      focusable="false"
      className="text-primary"
    >
      <ellipse cx="60" cy="88" rx="38" ry="5" className="fill-border" />
      <rect x="22" y="42" width="76" height="42" rx="6" fill="currentColor" />
      <rect x="16" y="30" width="88" height="18" rx="6" fill="currentColor" opacity="0.85" />
      <rect x="54" y="30" width="12" height="54" className="fill-accent" />
      <path
        d="M60 30C52 12 34 12 36 22s16 10 24 8Zm0 0c8-18 26-18 24-8s-16 10-24 8Z"
        className="fill-accent"
      />
      <path d="M98 14l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z" className="fill-accent" />
      <path
        d="M17 52l1.500 3.500L22 57l-3.500 1.500L17 62l-1.500-3.500L12 57l3.500-1.500L17 52Z"
        className="fill-accent"
      />
    </svg>
  );
}

/**
 * État vide commun (DS-07) : illustration, une phrase chaleureuse, une seule action principale.
 * `action` est le seul élément en couleur de l'écran.
 */
export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Dans une rubrique d'écran : sans illustration, une simple note encadrée. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <p className="rounded-xl border border-dashed border-border-strong/40 bg-surface px-4 py-3 text-sm text-foreground-muted">
        {title}
        {action ? <span className="ml-3 inline-block">{action}</span> : null}
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong/40 bg-surface px-6 py-10 text-center">
      <GiftIllustration />
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {description ? <p className="max-w-md text-foreground-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
