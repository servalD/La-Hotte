'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  AccountRole,
  getGetSessionQueryKey,
  useGetAccount,
  useLockSession,
  useSignOut,
} from '@wishlist/api-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { wipeDevice } from '@/lib/offline/device';
import { announceIdentity } from '@/lib/offline/identity-channel';
import { forgetProfileKeys } from '@/lib/offline/keys';
import { ConnectionStatus } from '@/lib/offline/connection-status';
import { InstallInvite, PushInvite } from '@/lib/pwa/engagement';
import { useQueuedActions } from '@/lib/offline/queue-context';
import { ConfirmButton } from '@/components/confirm-button';
import { purgeUserData } from '@/lib/session/purge';
import { Button } from '@/components/ui/button';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { NotificationsLink } from '@/features/notifications/notifications-screen';

type Area = 'profile' | 'account' | 'admin';

/** RBAC-02 : les liens d'un modérateur ; un administrateur a aussi les autres. */
const ADMIN_LINKS: { href: string; key: string; adminOnly: boolean }[] = [
  { href: '/admin', key: 'adminHome', adminOnly: false },
  { href: '/admin/moderation', key: 'adminModeration', adminOnly: false },
  { href: '/admin/accounts', key: 'adminAccounts', adminOnly: true },
  { href: '/admin/settings', key: 'adminSettings', adminOnly: true },
  { href: '/admin/audit', key: 'adminAudit', adminOnly: true },
];

const LINKS: Record<Exclude<Area, 'admin'>, { href: string; key: string }[]> = {
  profile: [
    { href: '/', key: 'home' },
    { href: '/lists', key: 'lists' },
    { href: '/events', key: 'events' },
    { href: '/directory', key: 'directory' },
    { href: '/circle', key: 'circle' },
    { href: '/gifts', key: 'gifts' },
    { href: '/cart', key: 'cart' },
    { href: '/balances', key: 'balances' },
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
  const waiting = useQueuedActions().length;
  // Le rôle n'est lu que hors profil : l'espace Compte et l'administration (RBAC-01).
  const account = useGetAccount({ query: { enabled: area !== 'profile' } });
  const role = account.data?.role ?? AccountRole.USER;
  const staff = role !== AccountRole.USER;
  const links =
    area === 'admin'
      ? ADMIN_LINKS.filter((link) => !link.adminOnly || role === AccountRole.ADMIN)
      : [
          ...LINKS[area],
          ...(area === 'account' && staff ? [{ href: '/admin', key: 'admin' }] : []),
        ];

  function onLock() {
    lock.mutate(undefined, {
      onSuccess: () => {
        // OFF-21 : après verrouillage, la clé du coffre n'est plus en mémoire.
        forgetProfileKeys();
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
        // Rien du compte ne reste dans le cache du navigateur, ni sur l'appareil (OFF-22), ni
        // dans les autres onglets (OFF-29).
        forgetProfileKeys();
        queryClient.clear();
        announceIdentity(null);
        void wipeDevice().finally(() => {
          router.replace('/auth/login');
        });
      },
    });
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 py-4 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-lg font-bold">{t('app')}</span>
        <nav aria-label={t('label')} className="flex flex-wrap items-center gap-1">
          {area === 'admin' ? (
            <Button asChild variant="ghost">
              <Link href="/account">{t('account')}</Link>
            </Button>
          ) : null}
          {links.map((link) => (
            <Button key={link.href} asChild variant="ghost">
              <Link href={link.href}>{t(link.key)}</Link>
            </Button>
          ))}
          {area === 'profile' ? (
            <>
              <NotificationsLink label={t('notifications')} />
              <Button asChild variant="ghost">
                <Link href="/profiles">{t('switchProfile')}</Link>
              </Button>
              <Button variant="ghost" onClick={onLock} disabled={lock.isPending}>
                {t('lock')}
              </Button>
            </>
          ) : null}
          {waiting > 0 ? (
            <Button asChild variant="ghost">
              <Link href="/actions">{t('actions', { count: waiting })}</Link>
            </Button>
          ) : null}
          {waiting > 0 ? (
            // OFF-22 : la déconnexion efface la file ; l'utilisateur est prévenu avant.
            <ConfirmButton
              variant="secondary"
              label={t('signOut')}
              title={t('signOutQueueTitle')}
              description={t('signOutQueueBody', { count: waiting })}
              confirmLabel={t('signOutAnyway')}
              cancelLabel={t('cancel')}
              onConfirm={onSignOut}
            />
          ) : (
            <Button variant="secondary" onClick={onSignOut} disabled={signOut.isPending}>
              {t('signOut')}
            </Button>
          )}
        </nav>
      </header>
      {area === 'profile' ? (
        <>
          <ConnectionStatus />
          {/* PWA-03, PWA-04 : proposées au moment où elles servent, jamais à la première visite. */}
          <InstallInvite />
          <PushInvite />
        </>
      ) : null}
      <main id="contenu" className="flex flex-1 flex-col gap-6">
        {children}
      </main>
      <footer className="flex justify-end border-t border-border pt-4">
        <ThemeSwitcher />
      </footer>
    </div>
  );
}
