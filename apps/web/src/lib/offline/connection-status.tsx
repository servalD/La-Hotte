'use client';

import { useIsFetching } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { requestBackgroundReplay } from '@/lib/pwa/service-worker';
import { useIsOnline } from './offline-provider';
import { useQueuedActions } from './queue-context';

/**
 * OFF-04, UX-33 : indicateur discret de l'état des données (à jour, mise à jour en cours, hors
 * ligne depuis telle heure), et bandeau fin, non bloquant, sans réseau.
 */
export function ConnectionStatus() {
  const t = useTranslations('connection');
  const format = useFormatter();
  const online = useIsOnline();
  const fetching = useIsFetching() > 0;
  const pending = useQueuedActions().filter((a) => a.state === 'pending').length;
  const [offlineSince, setOfflineSince] = useState<Date | null>(null);

  useEffect(() => {
    // L'heure de la coupure est notée à l'événement, pas pendant le rendu.
    const onOffline = () => {
      setOfflineSince(new Date());
    };
    const onOnline = () => {
      setOfflineSince(null);
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  // OFF-16 : sans réseau, avec des actions en file, le navigateur réveillera la file au retour.
  useEffect(() => {
    if (!online && pending > 0) requestBackgroundReplay();
  }, [online, pending]);

  if (!online) {
    return (
      <p
        role="status"
        className="w-full rounded-md border border-border bg-surface-muted px-3 py-1 text-sm"
      >
        <span aria-hidden="true">⚡ </span>
        {offlineSince
          ? t('offlineSince', { time: format.dateTime(offlineSince, { timeStyle: 'short' }) })
          : t('offline')}
        {pending > 0 ? ` · ${t('pending', { count: pending })}` : ''}
      </p>
    );
  }
  return (
    <p role="status" aria-live="polite" className="text-xs text-foreground-muted">
      {fetching ? t('updating') : t('upToDate')}
    </p>
  );
}
