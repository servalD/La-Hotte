'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  getListSessionsQueryKey,
  getListTrustedDevicesQueryKey,
  useListSessions,
  useListTrustedDevices,
  useRevokeSession,
  useRevokeTrustedDevice,
} from '@wishlist/api-client';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/** Sessions ouvertes (AUTH-05) et appareils de confiance (AUTH-12) : métadonnées seulement. */
export function DevicesSection() {
  const t = useTranslations('devices');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const sessions = useListSessions();
  const devices = useListTrustedDevices();
  const revokeSession = useRevokeSession();
  const revokeDevice = useRevokeTrustedDevice();

  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="sessions-title" className="flex flex-col gap-3">
        <h2 id="sessions-title" className="text-lg font-semibold">
          {t('sessions.title')}
        </h2>
        <p className="text-sm text-foreground-muted">{t('sessions.who')}</p>
        <ul className="flex flex-col gap-2">
          {sessions.data?.items.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-4"
            >
              <div className="min-w-0">
                {/* Texte déclaré par l'appareil : affiché tel quel, jamais interprété. */}
                <p className="truncate font-medium">{session.userAgent || t('unknownDevice')}</p>
                <p className="text-sm text-foreground-muted">
                  {t('lastSeen', { date: when(session.lastSeenAt) })}
                </p>
              </div>
              {session.current ? (
                <span className="text-sm font-medium">{t('thisDevice')}</span>
              ) : (
                <Button
                  variant="secondary"
                  disabled={revokeSession.isPending}
                  onClick={() => {
                    revokeSession.mutate(
                      { id: session.id },
                      {
                        onSuccess: () => {
                          void queryClient.invalidateQueries({
                            queryKey: getListSessionsQueryKey(),
                          });
                        },
                      },
                    );
                  }}
                >
                  {t('sessions.revoke')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="devices-title" className="flex flex-col gap-3">
        <h2 id="devices-title" className="text-lg font-semibold">
          {t('trusted.title')}
        </h2>
        <p className="text-sm text-foreground-muted">{t('trusted.who')}</p>
        {devices.data?.items.length === 0 ? <p>{t('trusted.none')}</p> : null}
        <ul className="flex flex-col gap-2">
          {devices.data?.items.map((device) => (
            <li
              key={device.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{device.userAgent || t('unknownDevice')}</p>
                <p className="text-sm text-foreground-muted">
                  {t('trusted.until', { date: when(device.expiresAt) })}
                </p>
              </div>
              <Button
                variant="secondary"
                disabled={revokeDevice.isPending}
                onClick={() => {
                  revokeDevice.mutate(
                    { id: device.id },
                    {
                      onSuccess: () => {
                        void queryClient.invalidateQueries({
                          queryKey: getListTrustedDevicesQueryKey(),
                        });
                      },
                    },
                  );
                }}
              >
                {t('trusted.revoke')}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
