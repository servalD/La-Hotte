'use client';

import { AccountRole, useGetAccount } from '@wishlist/api-client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { ThemeMenuGroup } from '@/components/theme-switcher';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDownIcon, BrandMark, UserIcon } from '@/components/ui/icons';
import { useSignOutConfirm } from '@/features/session/sign-out-confirm';
import { cn } from '@/lib/utils/cn';

export type SectionLink = { href: string; key: string };

type Controls = { waiting: number; signingOut: boolean; onSignOut: () => void };

/**
 * En-tête des espaces Compte et Administration (UX-13) : pas de profil actif ici, donc un menu de
 * compte (et non l'avatar d'un profil) et, dessous, la rangée des rubriques de l'espace.
 */
export function AccountHeader({
  links,
  area,
  ...controls
}: Controls & { links: SectionLink[]; area: 'account' | 'admin' }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const strip = useRef<HTMLElement>(null);
  // Sur mobile la rangée défile : la rubrique active doit être visible à l'arrivée.
  useEffect(() => {
    const active = strip.current?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [pathname]);
  return (
    <header className="sticky top-0 z-30 -mx-4 border-b border-border bg-background/90 px-4 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-3xl items-center justify-between gap-3">
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-md font-display text-xl font-semibold text-primary"
        >
          <BrandMark />
          {t('app')}
        </Link>
        <AccountMenu area={area} {...controls} />
      </div>
      <nav
        ref={strip}
        aria-label={t('label')}
        className="mx-auto -mb-px flex max-w-3xl gap-1 overflow-x-auto pb-2"
      >
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-touch shrink-0 items-center rounded-full px-4 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground-muted hover:bg-surface-muted hover:text-foreground',
              )}
            >
              {t(link.key)}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

/** Menu de compte : retour aux profils, thème, déconnexion. L'adresse y est masquée. */
function AccountMenu({ area, waiting, signingOut, onSignOut }: Controls & { area: string }) {
  const t = useTranslations('nav');
  const account = useGetAccount();
  const staff = (account.data?.role ?? AccountRole.USER) !== AccountRole.USER;
  const signOutConfirm = useSignOutConfirm(waiting, onSignOut);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('accountMenuLabel')}
            className="relative inline-flex min-h-touch items-center gap-1 rounded-full pr-2 pl-1 hover:bg-surface-muted"
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-surface-muted text-foreground">
              <UserIcon width={20} height={20} />
            </span>
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
          {account.data ? (
            <DropdownMenuLabel className="max-w-72 text-sm font-semibold text-foreground">
              {maskEmail(account.data.email)}
            </DropdownMenuLabel>
          ) : null}
          {waiting > 0 ? (
            <DropdownMenuItem asChild>
              <Link href="/actions">{t('actions', { count: waiting })}</Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild>
            <Link href="/profiles">{t('profiles')}</Link>
          </DropdownMenuItem>
          {area === 'admin' ? (
            <DropdownMenuItem asChild>
              <Link href="/account">{t('account')}</Link>
            </DropdownMenuItem>
          ) : null}
          {staff && area !== 'admin' ? (
            <DropdownMenuItem asChild>
              <Link href="/admin">{t('admin')}</Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <ThemeMenuGroup />
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={signingOut} onSelect={signOutConfirm.request}>
            {t('signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {signOutConfirm.dialog}
    </>
  );
}

/**
 * `g•••@domaine` : l'espace Compte s'ouvre aussi depuis l'écran familial de choix du profil, devant
 * les proches qui partagent l'appareil. L'adresse entière reste dans la rubrique Compte.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '•••';
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}
