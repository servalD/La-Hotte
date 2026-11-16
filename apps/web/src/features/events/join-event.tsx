'use client';

import {
  type EventLinkPreviewView,
  useInspectEventLink,
  useRedeemEventLink,
} from '@wishlist/api-client';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useFragmentToken } from '@/features/auth/fragment-token';
import { eventErrorKey } from './api-errors';
import { formatDay } from './format';

/**
 * EVT-16 : ouverture d'un lien d'invitation. Le jeton vient du fragment ; c'est le profil actif
 * qui rejoint. Tout refus qui pourrait dire quelque chose de l'événement a la même forme.
 */
export function JoinEvent() {
  const t = useTranslations('events.join');
  const te = useTranslations('events.errors');
  const locale = useLocale();
  const router = useRouter();
  const token = useFragmentToken();
  const inspect = useInspectEventLink();
  const redeem = useRedeemEventLink();
  const [preview, setPreview] = useState<EventLinkPreviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    inspect.mutate(
      { data: { token } },
      {
        onSuccess: setPreview,
        onError: (e) => {
          setError(te(eventErrorKey(e)));
        },
      },
    );
  }, [token, inspect, te]);

  if (token === undefined) return null;
  if (token === null) return <p role="alert">{te('EVENT_INVITATION_INVALID')}</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!preview) return <p role="status">{t('loading')}</p>;

  return (
    <div className="flex flex-col gap-3">
      <p>
        {t('body', {
          name: preview.inviter?.displayName ?? t('someone'),
          title: preview.title,
          date: formatDay(preview.date, locale),
        })}
      </p>
      <p className="text-sm text-foreground-muted">{t('who')}</p>
      <Button
        className="self-start"
        disabled={redeem.isPending}
        onClick={() => {
          redeem.mutate(
            { data: { token } },
            {
              onSuccess: (joined) => {
                router.push(`/events/${joined.eventId}`);
              },
              onError: (e) => {
                setError(te(eventErrorKey(e)));
              },
            },
          );
        }}
      >
        {preview.alreadyParticipant ? t('open') : t('accept')}
      </Button>
    </div>
  );
}
