import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils/cn';

/** Message d'état dans une page (analyse en cours, échec, avertissement). Le texte porte le sens, la couleur le souligne. */
const calloutVariants = cva('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', {
  variants: {
    tone: {
      info: 'border-border bg-surface-muted text-foreground',
      attention: 'border-accent bg-accent/15 text-foreground',
      danger: 'border-danger bg-danger/10 text-foreground',
    },
  },
  defaultVariants: { tone: 'info' },
});

export function Callout({
  className,
  tone,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof calloutVariants>) {
  return <div className={cn(calloutVariants({ tone }), className)} {...props} />;
}
