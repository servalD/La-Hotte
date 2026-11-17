'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Enregistre le service worker (production seulement) et propose la nouvelle version quand elle
 * est prête (PWA-06) : jamais de rechargement forcé, l'utilisateur choisit le moment.
 */
export function ServiceWorkerUpdates() {
  const t = useTranslations('pwa');
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        if (cancelled) return;
        if (registration.waiting && navigator.serviceWorker.controller) {
          setWaiting(registration.waiting);
        }
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          installing?.addEventListener('statechange', () => {
            // Une première installation n'est pas une mise à jour : rien à proposer.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setWaiting(installing);
            }
          });
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!waiting) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-center gap-3 border-t border-border bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <span>{t('updateReady')}</span>
      <Button
        onClick={() => {
          navigator.serviceWorker.addEventListener(
            'controllerchange',
            () => {
              window.location.reload();
            },
            { once: true },
          );
          waiting.postMessage({ type: 'SKIP_WAITING' });
        }}
      >
        {t('reload')}
      </Button>
    </div>
  );
}

/** OFF-16 : demande au navigateur de réveiller la file quand le réseau revient (s'il le sait). */
export function requestBackgroundReplay(): void {
  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.ready
    .then((registration) => {
      const sync = (
        registration as ServiceWorkerRegistration & {
          sync?: { register: (tag: string) => Promise<void> };
        }
      ).sync;
      return sync?.register('lh-queue');
    })
    .catch(() => undefined);
}
