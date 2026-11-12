'use client';

import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useId, useSyncExternalStore } from 'react';

const THEMES = ['system', 'light', 'dark'] as const;

const subscribe = () => () => undefined;

/** Choix du thème. Une liste native : accessible au clavier et au lecteur d'écran sans effort. */
export function ThemeSwitcher() {
  const t = useTranslations('theme');
  const { theme, setTheme } = useTheme();
  const id = useId();
  // Le thème n'est connu qu'au navigateur : on évite un écart d'hydratation.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-foreground-muted">
        {t('label')}
      </label>
      <select
        id={id}
        className="h-touch rounded-md border border-border-strong bg-surface px-2 text-sm"
        value={mounted ? (theme ?? 'system') : 'system'}
        onChange={(event) => {
          setTheme(event.target.value);
        }}
      >
        {THEMES.map((value) => (
          <option key={value} value={value}>
            {t(value)}
          </option>
        ))}
      </select>
    </div>
  );
}
