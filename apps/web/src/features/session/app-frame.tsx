'use client';

import { useQueryClient } from '@tanstack/react-query';
import { getGetSessionQueryKey, useLockSession, useSignOut } from '@wishlist/api-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { purgeUserData } from '@/lib/session/purge';
import { Button } from '@/components/ui/button';
import { ThemeSwitcher } from '@/components/theme-switcher';

type Area = 'profile' | 'account';

const LINKS: Record<Area, { href: string; key: string }[]> = {
  profile: [
    { href: '/', key: 'home' },
    { href: '/lists', key: 'lists' },
    { href: '/directory', key: 'directory' },
    { href: '/circle', key: 'circle' },
    { href: '/invitations', key: 'invitations' },
    { href: '/settings', key: 'settings' },
  ],
  account: [
    { href: '/profiles', key: 'profiles' },
    { href: '/account', key: 'account' },
    { href: '/account/profiles', key: 'accountProfiles' },
    { href: '/account/security', key: 'security' },
    { href: '/account/wards', key: 'wards' },
  ],
};

/** Cadre des écrans connectés : navigation, verrouillage du profil, déconnexion. */
export function AppFrame({ area, children }: { area: Area; children: ReactNode }) {
  const t = useTranslations('nav');
  const router = useRouter();
  const queryClient = useQueryClient();
  const lock = useLockSession();
  const signOut = useSignOut();

  function onLock() {
    lock.mutate(undefined, {
      onSuccess: () => {
        purgeUserData(queryClient);
        void queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() }).then(() => {
          router.replace('/profiles/unlock');
        });
      },
    });
  }

  function onSignOut() {
    signOut.mutate(undefined, {
      onSettled: () => {
        // Rien du compte ne reste dans le cache du navigateur.
        queryClient.clear();
        router.replace('/auth/login');
      },
    });
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-4 py-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-lg font-bold">{t('app')}</span>
        <nav aria-label={t('label')} className="flex flex-wrap items-center gap-1">
          {LINKS[area].map((link) => (
            <Button key={link.href} asChild variant="ghost">
              <Link href={link.href}>{t(link.key)}</Link>
            </Button>
          ))}
          {area === 'profile' ? (
            <>
              <Button asChild variant="ghost">
                <Link href="/profiles">{t('switchProfile')}</Link>
              </Button>
              <Button variant="ghost" onClick={onLock} disabled={lock.isPending}>
                {t('lock')}
              </Button>
            </>
          ) : null}
          <Button variant="secondary" onClick={onSignOut} disabled={signOut.isPending}>
            {t('signOut')}
          </Button>
        </nav>
      </header>
      <main id="contenu" className="flex flex-1 flex-col gap-6">
        {children}
      </main>
      <footer className="flex justify-end border-t border-border pt-4">
        <ThemeSwitcher />
      </footer>
    </div>
  );
}
