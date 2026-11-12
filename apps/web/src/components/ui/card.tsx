import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils/cn';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn('rounded-lg border border-border bg-surface p-6 shadow-sm', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, children, ...props }: ComponentProps<'h2'>) {
  return (
    <h2 className={cn('text-lg font-semibold text-foreground', className)} {...props}>
      {children}
    </h2>
  );
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-foreground-muted', className)} {...props} />;
}
