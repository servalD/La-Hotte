'use client';

import { cn } from '@/lib/utils/cn';

/**
 * Filtre à choix exclusif (en cours / archivées…). Ce n'est pas une action : l'option retenue est
 * sobre, pour que l'action principale de l'écran reste la seule en couleur (DS-08).
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex gap-1 rounded-full bg-surface-muted p-1"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              onChange(option.value);
            }}
            className={cn(
              'min-h-10 rounded-full px-4 text-sm font-medium transition-colors',
              selected
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-foreground-muted hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
