'use client';

import { getPushKey, subscribePush } from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Moments où une proposition sert (PWA-03, PWA-04) : un premier souhait ajouté appelle
 * l'installation ; une première réservation ou invitation, les notifications.
 */
export type Moment = 'wish-added' | 'reservation' | 'invitation';
const EVENT = 'lh:moment';

export function announceMoment(moment: Moment): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<Moment>(EVENT, { detail: moment }));
}

function useMoment(wanted: readonly Moment[]): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const onMoment = (event: Event) => {
      if (wanted.includes((event as CustomEvent<Moment>).detail)) setSeen(true);
    };
    window.addEventListener(EVENT, onMoment);
    return () => {
      window.removeEventListener(EVENT, onMoment);
    };
  }, [wanted]);
  return seen;
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

const INSTALL_MOMENTS: readonly Moment[] = ['wish-added'];
const PUSH_MOMENTS: readonly Moment[] = ['reservation', 'invitation'];

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * PWA-03 : invitation à installer après un premier usage réussi (un souhait ajouté), jamais à la
 * première visite. Sur iOS, sans invite du navigateur, un mini-guide « Partager → Sur l'écran
 * d'accueil ». Refusée, elle ne revient pas dans la session.
 */
export function InstallInvite() {
  const t = useTranslations('pwa');
  const moment = useMoment(INSTALL_MOMENTS);
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    const apple = /iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone();
    const timer = setTimeout(() => {
      setIos(apple);
    }, 0);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      clearTimeout(timer);
    };
  }, []);

  if (!moment || dismissed || (!deferred && !ios)) return null;
  return (
    <aside
      aria-label={t('installTitle')}
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4"
    >
      <p className="font-medium">{t('installTitle')}</p>
      <p className="text-sm">{deferred ? t('installBody') : t('installIos')}</p>
      <div className="flex gap-2">
        {deferred ? (
          <Button
            onClick={() => {
              void deferred.prompt().finally(() => {
                setDeferred(null);
              });
            }}
          >
            {t('install')}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          onClick={() => {
            setDismissed(true);
          }}
        >
          {t('later')}
        </Button>
      </div>
    </aside>
  );
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * PWA-04 : notifications demandées au moment où elles servent (première réservation, première
 * invitation), avec l'explication avant la demande du navigateur. Le contenu des push reste
 * neutre (NOT-06).
 */
export function PushInvite() {
  const t = useTranslations('pwa');
  const moment = useMoment(PUSH_MOMENTS);
  const [state, setState] = useState<'idle' | 'done' | 'dismissed' | 'failed'>('idle');
  const supported =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window;
  if (!moment || !supported || state === 'dismissed' || Notification.permission !== 'default') {
    return state === 'done' ? <p role="status">{t('pushOn')}</p> : null;
  }
  const enable = async () => {
    try {
      const { publicKey } = await getPushKey();
      if (!publicKey) throw new Error('VAPID');
      if ((await Notification.requestPermission()) !== 'granted') {
        setState('dismissed');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey),
      });
      const json = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      await subscribePush({
        endpoint: json.endpoint ?? '',
        keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
      });
      setState('done');
    } catch {
      setState('failed');
    }
  };
  return (
    <aside
      aria-label={t('pushTitle')}
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4"
    >
      <p className="font-medium">{t('pushTitle')}</p>
      <p className="text-sm">{t('pushBody')}</p>
      {state === 'failed' ? (
        <p role="alert" className="text-sm text-danger">
          {t('pushFailed')}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={() => void enable()}>{t('pushEnable')}</Button>
        <Button
          variant="ghost"
          onClick={() => {
            setState('dismissed');
          }}
        >
          {t('later')}
        </Button>
      </div>
    </aside>
  );
}

/**
 * PWA-05 : pastille de l'icône = notifications non lues du profil, telles que l'API les compte
 * (déjà filtrées par le moteur : aucune activité soumise à la surprise, NOT-10).
 */
export function useAppBadge(count: number): void {
  useEffect(() => {
    if (!('setAppBadge' in navigator) || !('clearAppBadge' in navigator)) return;
    void (count > 0 ? navigator.setAppBadge(Math.min(count, 99)) : navigator.clearAppBadge()).catch(
      () => undefined,
    );
  }, [count]);
}
