'use client';

import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils/cn';

// Radix : rôles tablist/tab/tabpanel, flèches et Origine/Fin au clavier, focus géré (A11Y-02).
export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1 pb-2', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex min-h-touch shrink-0 items-center rounded-full px-4 text-sm font-medium transition-colors',
        'text-foreground-muted hover:bg-surface-muted hover:text-foreground',
        'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('flex flex-col gap-6 pt-6', className)} {...props} />;
}
