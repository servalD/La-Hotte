'use client';

import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils/cn';

// Radix gère le clavier (flèches, Échap, recherche par lettre) et rend le focus au déclencheur.
export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

export function DropdownMenuContent({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className={cn(
          'z-50 min-w-60 rounded-xl border border-border bg-surface p-1.5 shadow-lg',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      className={cn(
        'flex min-h-touch cursor-pointer items-center gap-2 rounded-md px-3 text-sm outline-none select-none',
        'data-[highlighted]:bg-surface-muted data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn('px-3 pt-2 pb-1 text-xs font-medium text-foreground-muted', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn('my-1.5 h-px bg-border', className)} {...props} />;
}

/** Choix exclusif dans un groupe : le point marque la valeur retenue (en plus de `aria-checked`). */
export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem
      className={cn(
        'flex min-h-touch cursor-pointer items-center gap-2 rounded-md px-3 text-sm outline-none select-none',
        'data-[highlighted]:bg-surface-muted data-[state=checked]:font-semibold',
        className,
      )}
      {...props}
    >
      <span className="flex size-4 items-center justify-center" aria-hidden="true">
        <MenuPrimitive.ItemIndicator>
          <span className="block size-2 rounded-full bg-primary" />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}
