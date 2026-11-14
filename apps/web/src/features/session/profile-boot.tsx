'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  getGetSessionQueryKey,
  ProfileViewPinRelock,
  useGetOwnProfile,
  useLockSession,
} from '@wishlist/api-client';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useEffect } from 'react';
import { isLocale, LOCALE_COOKIE } from '@/i18n/config';

// Une ouverture de l'application = un chargement de page (PIN-07, ADR 0013).
let launchHandled = false;

/**
 * Tâches de démarrage d'un profil déverrouillé, sans rendu : la langue du profil prend le relais
 * du cookie de langue (I18N-01), et un profil réglé sur « à chaque ouverture » est reverrouillé au
 * lancement (`POST /session/lock`, PIN-07).
 */
export function ProfileBoot() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const current = useLocale();
  const { data: profile } = useGetOwnProfile();
  const lock = useLockSession();

  const profileLocale = profile?.locale.slice(0, 2);
  useEffect(() => {
    if (!profileLocale || !isLocale(profileLocale) || profileLocale === current) return;
    // Préférence d'affichage, sans donnée sensible.
    document.cookie = `${LOCALE_COOKIE}=${profileLocale}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [profileLocale, current, router]);

  const mustLock = profile?.hasPin && profile.pinRelock === ProfileViewPinRelock.EVERY_OPEN;
  useEffect(() => {
    if (!mustLock || launchHandled) return;
    launchHandled = true;
    lock.mutate(undefined, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() }).then(() => {
          router.replace('/profiles/unlock');
        });
      },
    });
  }, [mustLock, lock, queryClient, router]);

  return null;
}
