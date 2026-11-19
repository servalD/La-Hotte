'use client';

import { useGetOwnProfile } from '@wishlist/api-client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ComponentType, ComponentProps } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  BasketIcon,
  CalendarIcon,
  ChevronDownIcon,
  HomeIcon,
  ListIcon,
  BrandMark,
} from '@/components/ui/icons';
import { ThemeMenuGroup } from '@/components/theme-switcher';
import { NotificationsLink } from '@/features/notifications/notifications-screen';
import { useSignOutConfirm } from '@/features/session/sign-out-confirm';
import { ProfileAvatar } from '@/features/profiles/profile-avatar';
import { cn } from '@/lib/utils/cn';

/** UX-10 : quatre entrées, les mêmes sur mobile (barre du bas) et sur bureau (en-tête). */
const TABS: { href: string; key: string; Icon: ComponentType<ComponentProps<'svg'>> }[] = [
  { href: '/', key: 'home', Icon: HomeIcon },
  { href: '/lists', key: 'lists', Icon: ListIcon },
  { href: '/events', key: 'events', Icon: CalendarIcon },
  { href: '/cart', key: 'cart', Icon: BasketIcon },
];

/** Écrans qui ne sont plus dans la navigation principale : ils vivent dans le menu du profil (UX-13). */
const MENU_LINKS: { href: string; key: string }[] = [
  { href: '/gifts', key: 'gifts' },
  { href: '/balances', key: 'balances' },
  { href: '/directory', key: 'directory' },
  { href: '/circle', key: 'circle' },
  { href: '/invitations', key: 'invitations' },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

type Controls = {
  waiting: number;
  locking: boolean;
  signingOut: boolean;
  onLock: () => void;
  onSignOut: () => void;
};

/** En-tête d'un profil : marque, navigation (bureau), cloche et menu du profil. */
export function ProfileHeader(controls: Controls) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 -mx-4 border-b border-border bg-background/90 px-4 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-4xl items-center justify-between gap-3">
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-md font-display text-xl font-semibold text-primary"
        >
          <BrandMark />
          {t('app')}
        </Link>
        <nav aria-label={t('label')} className="hidden items-center gap-1 md:flex">
          {TABS.map(({ href, key, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-touch items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground-muted hover:bg-surface-muted hover:text-foreground',
                )}
              >
                <Icon width={18} height={18} />
                {t(key)}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-1">
          <NotificationsLink label={t('notifications')} />
          <ProfileMenu {...controls} />
        </div>
      </div>
    </header>
  );
}

/** Menu de l'avatar : tout ce qui n'est pas une rubrique (UX-13). */
function ProfileMenu({ waiting, locking, signingOut, onLock, onSignOut }: Controls) {
  const t = useTranslations('nav');
  const { data: profile } = useGetOwnProfile();
  const signOutConfirm = useSignOutConfirm(waiting, onSignOut);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('menuLabel')}
            className="relative inline-flex min-h-touch items-center gap-1 rounded-full pr-2 pl-1 hover:bg-surface-muted"
          >
            {profile ? (
              <ProfileAvatar name={profile.displayName} color={profile.accentColor} size={36} />
            ) : (
              <span className="size-9 rounded-full bg-surface-muted" aria-hidden="true" />
            )}
            <ChevronDownIcon width={16} height={16} className="text-foreground-muted" />
            {waiting > 0 ? (
              <span
                aria-hidden="true"
                className="absolute top-1.5 left-7 size-3 rounded-full border-2 border-background bg-accent"
              />
            ) : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {profile ? (
            <DropdownMenuLabel className="text-sm font-semibold text-foreground">
              {profile.displayName}
            </DropdownMenuLabel>
          ) : null}
          {waiting > 0 ? (
            <DropdownMenuItem asChild>
              <Link href="/actions">{t('actions', { count: waiting })}</Link>
            </DropdownMenuItem>
          ) : null}
          {MENU_LINKS.map((link) => (
            <DropdownMenuItem key={link.href} asChild>
              <Link href={link.href}>{t(link.key)}</Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings">{t('settings')}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/profiles">{t('switchProfile')}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={locking} onSelect={onLock}>
            {t('lock')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <ThemeMenuGroup />
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/account">{t('account')}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={signingOut} onSelect={signOutConfirm.request}>
            {t('signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {signOutConfirm.dialog}
    </>
  );
}

/** Barre d'onglets du bas, mobile seulement (UX-13). */
export function BottomTabs() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  return (
    <nav
      aria-label={t('mobileLabel')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto grid max-w-4xl grid-cols-4">
        {TABS.map(({ href, key, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium',
                  active ? 'text-primary' : 'text-foreground-muted',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-14 items-center justify-center rounded-full transition-colors',
                    active && 'bg-primary/12',
                  )}
                >
                  <Icon width={22} height={22} />
                </span>
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
