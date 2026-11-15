'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Codes de secours : affichés une seule fois (SEC-22). À copier ou imprimer ; l'écran ne les
 * conserve nulle part et ne les envoie à aucun service.
 */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const t = useTranslations('totp');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" role="region" aria-label={t('codes.title')}>
      <h3 className="font-semibold">{t('codes.title')}</h3>
      <p className="text-sm text-foreground-muted">{t('codes.once')}</p>
      <ul className="grid grid-cols-2 gap-2 font-mono text-base print:text-black">
        {codes.map((code) => (
          <li key={code} className="rounded-md border border-border bg-surface-muted px-3 py-2">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? t('codes.copied') : t('codes.copy')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            window.print();
          }}
        >
          {t('codes.print')}
        </Button>
        <Button onClick={onDone}>{t('codes.saved')}</Button>
      </div>
      <span role="status" className="sr-only">
        {copied ? t('codes.copied') : ''}
      </span>
    </div>
  );
}
