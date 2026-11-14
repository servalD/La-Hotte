'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  getGetSessionQueryKey,
  ProfileViewPinRelock,
  useGetOwnProfile,
  useLockSession,
} from '@wishlist/api-client';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { isLocale, LOCALE_COOKIE } from '@/i18n/config';
import { launchHandled, markLaunchHandled } from '@/lib/session/launch';
import { purgeUserData } from '@/lib/session/purge';

/**
 * Démarrage d'un profil déverrouillé. N'affiche les écrans qu'une fois la décision prise (PIN-07) :
 * un profil réglé sur « à chaque ouverture » est reverrouillé au lancement (`POST /session/lock`)
 * avant toute lecture de ses données, et si le profil ne peut pas être lu, rien ne s'affiche.
 * La langue du profil prend le relais du cookie de langue (I18N-01).
 */
export function ProfileBoot({ children }: { children: ReactNode }) {
  const t = useTranslations('session');
  const router = useRouter();
  const queryClient = useQueryClient();
  const current = useLocale();
  const { data: profile, isError, refetch } = useGetOwnProfile();
  const lock = useLockSession();

  const profileLocale = profile?.locale.slice(0, 2);
  useEffect(() => {
    if (!profileLocale || !isLocale(profileLocale) || profileLocale === current) return;
    // Préférence d'affichage, sans donnée sensible ; `Secure` dès que la page l'est.
    const secure = window.location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${LOCALE_COOKIE}=${profileLocale}; path=/; max-age=31536000; samesite=lax${secure}`;
    router.refresh();
  }, [profileLocale, current, router]);

  const mustLock =
    profile !== undefined &&
    profile.hasPin &&
    profile.pinRelock === ProfileViewPinRelock.EVERY_OPEN &&
    !launchHandled();

  useEffect(() => {
    if (profile === undefined) return;
    if (!mustLock) {
      markLaunchHandled();
      return;
    }
    markLaunchHandled();
    lock.mutate(undefined, {
      onSuccess: () => {
        purgeUserData(queryClient);
        void queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() }).then(() => {
          router.replace('/profiles/unlock');
        });
      },
    });
  }, [profile, mustLock, lock, queryClient, router]);

  if (isError || lock.isError) {
    return (
      <div role="alert" className="flex flex-col gap-3 p-6">
        <p>{t('profileUnreadable')}</p>
        <Button
          className="self-start"
          onClick={() => {
            void refetch();
          }}
        >
          {t('retry')}
        </Button>
      </div>
    );
  }
  if (profile === undefined || mustLock || lock.isPending || lock.isSuccess) {
    return (
      <div className="p-6" role="status" aria-label={t('loading')}>
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }
  return <>{children}</>;
}
