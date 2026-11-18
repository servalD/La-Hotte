'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  AccountRole,
  getGetSessionQueryKey,
  useGetAccount,
  useLockSession,
  useSignOut,
} from '@wishlist/api-client';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { wipeDevice } from '@/lib/offline/device';
import { announceIdentity } from '@/lib/offline/identity-channel';
import { forgetProfileKeys } from '@/lib/offline/keys';
import { ConnectionStatus } from '@/lib/offline/connection-status';
import { InstallInvite, PushInvite } from '@/lib/pwa/engagement';
import { useQueuedActions } from '@/lib/offline/queue-context';
import { purgeUserData } from '@/lib/session/purge';
import { SiteFooter } from '@/components/site-footer';
import { AccountHeader } from '@/features/session/account-nav';
import { BottomTabs, ProfileHeader } from '@/features/session/profile-nav';

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

  const profile = area === 'profile';

  return (
    <div
      className={
        profile
          ? 'mx-auto flex min-h-dvh max-w-4xl flex-col gap-6 pr-[max(1rem,env(safe-area-inset-right))] pb-24 pl-[max(1rem,env(safe-area-inset-left))] md:pb-6'
          : 'mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]'
      }
    >
      {profile ? (
        <ProfileHeader
          waiting={waiting}
          locking={lock.isPending}
          signingOut={signOut.isPending}
          onLock={onLock}
          onSignOut={onSignOut}
        />
      ) : (
        <AccountHeader
          area={area}
          links={links}
          waiting={waiting}
          signingOut={signOut.isPending}
          onSignOut={onSignOut}
        />
      )}
      {profile ? (
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
      <SiteFooter />
      {profile ? <BottomTabs /> : null}
    </div>
  );
}
