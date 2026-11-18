import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils/cn';

/** Étiquette courte (type de liste, audience, rôle). Le sens est toujours dans le texte, jamais dans la seule couleur (A11Y-03). */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-muted text-foreground-muted',
        brand: 'bg-primary/10 text-primary',
        accent: 'bg-accent/30 text-foreground',
        success: 'bg-success/12 text-success',
        info: 'bg-state-purchased/12 text-state-purchased',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
