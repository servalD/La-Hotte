import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils/cn';

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'h-touch w-full rounded-md border border-border-strong bg-surface px-3 text-base text-foreground',
        'placeholder:text-foreground-muted',
        'aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}
