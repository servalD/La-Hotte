import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/ui/icons';

/**
 * Pied de page commun aux écrans connectés (UX-13). Marque et phrase d'accroche ; `children` reçoit
 * un réglage propre à l'écran. Les liens légaux s'ajouteront ici dès que ces pages existeront.
 */
export function SiteFooter({ children }: { children?: ReactNode }) {
  const t = useTranslations('app');
  return (
    <footer className="mt-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border py-6 text-sm text-foreground-muted">
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 font-display text-base font-semibold text-primary">
          <BrandMark />
          {t('name')}
        </span>
        <p>{t('tagline')}</p>
      </div>
      {children}
    </footer>
  );
}
