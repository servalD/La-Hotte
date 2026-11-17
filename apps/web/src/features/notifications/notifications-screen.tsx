'use client';

import { useAppBadge } from '@/lib/pwa/engagement';
import { useQueryClient } from '@tanstack/react-query';
import {
  getCountUnreadNotificationsQueryKey,
  getListNotificationsQueryKey,
  type NotificationView,
  useCountUnreadNotifications,
  useListNotifications,
  useMarkNotificationsRead,
} from '@wishlist/api-client';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/** Où conduit une notification : la liste de l'élément, l'événement, ou rien. */
function hrefOf(n: NotificationView): string | null {
  if (n.listId) return `/lists/${n.listId}`;
  if (n.eventId) return `/events/${n.eventId}`;
  return null;
}

/**
 * NOT-01, NOT-11, NOT-18 : centre de notifications du profil actif. Titres et noms relus par l'API
 * à chaque lecture ; une notification devenue invisible n'arrive pas ici.
 */
export function NotificationsScreen() {
  const t = useTranslations('notifications');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const { data, isPending } = useListNotifications();
  const markRead = useMarkNotificationsRead();
  const items = data?.items ?? [];
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getCountUnreadNotificationsQueryKey() });
  };
  const latest = items[0]?.seq;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        {latest !== undefined && items.some((n) => !n.read) ? (
          <Button
            variant="secondary"
            onClick={() => {
              markRead.mutate({ data: { upToSeq: latest } }, { onSuccess: refresh });
            }}
          >
            {t('markAll')}
          </Button>
        ) : null}
      </div>
      {isPending ? <p role="status">{t('loading')}</p> : null}
      {!isPending && items.length === 0 ? <p>{t('empty')}</p> : null}
      <ul className="flex flex-col gap-2">
        {items.map((n) => {
          const href = hrefOf(n);
          const label = t(`types.${n.type.replace('.', '_')}`, {
            who: n.actorName ?? t('someone'),
            title: n.title ?? '',
            context: n.context ?? '',
          });
          return (
            <li
              key={n.id}
              className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3"
            >
              <p className="text-sm">
                {!n.read ? (
                  <span className="font-semibold">
                    <span aria-hidden="true">● </span>
                    <span className="sr-only">{t('unread')} </span>
                  </span>
                ) : null}
                {href ? (
                  <Link
                    href={href}
                    className="underline"
                    onClick={() => {
                      markRead.mutate({ data: { ids: [n.id] } }, { onSuccess: refresh });
                    }}
                  >
                    {label}
                  </Link>
                ) : (
                  label
                )}
              </p>
              <p className="text-xs text-foreground-muted">
                {format.relativeTime(new Date(n.createdAt))}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** VIS-22 : compteur relu par l'API (99 au plus), dans l'en-tête. */
export function NotificationsLink({ label }: { label: string }) {
  const t = useTranslations('notifications');
  const { data } = useCountUnreadNotifications();
  const count = data?.count ?? 0;
  useAppBadge(count);
  return (
    <Button asChild variant="ghost">
      <Link href="/notifications" aria-label={count > 0 ? t('linkCount', { count }) : label}>
        {label}
        {count > 0 ? (
          <span
            aria-hidden="true"
            className="ml-1 rounded-full bg-primary px-2 text-xs text-primary-foreground"
          >
            {count >= 99 ? '99+' : count}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
