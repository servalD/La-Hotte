import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils/cn';

/** Bouton de base (DS-02). Zone tactile ≥ 44 px pour toutes les tailles interactives. */
export const buttonVariants = cva(
  [
    'inline-flex min-h-touch items-center justify-center gap-2 rounded-md px-4 text-sm font-medium',
    'transition-[background-color,opacity] duration-[var(--ds-duration-micro)] ease-standard',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary: 'border border-border-strong bg-surface text-foreground hover:bg-surface-muted',
        ghost: 'text-foreground hover:bg-surface-muted',
        danger: 'bg-danger text-danger-foreground hover:opacity-90',
      },
      size: {
        md: 'h-touch',
        lg: 'h-12 px-6 text-base',
        icon: 'size-touch px-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Rend l'enfant (un lien, par exemple) avec l'apparence du bouton. */
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
