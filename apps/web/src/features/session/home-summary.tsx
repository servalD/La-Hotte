'use client';

import { useGetOwnProfile, useGetOwnTransfer, useListLinks } from '@wishlist/api-client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ProfileAvatar } from '@/features/profiles/profile-avatar';

/** Accueil d'un profil de la phase 1 : qui je suis, ce qui attend ma validation. */
export function HomeSummary() {
  const t = useTranslations('home');
  const { data: profile } = useGetOwnProfile();
  const links = useListLinks();
  const transfer = useGetOwnTransfer();
  const waiting = links.data?.items.filter((l) => l.awaitingMyApproval).length ?? 0;

  if (!profile) return <Skeleton className="h-24 w-full" />;

  return (
    <>
      <header className="flex items-center gap-4">
        <ProfileAvatar name={profile.displayName} color={profile.accentColor} />
        <div>
          <h1 className="text-2xl font-bold">{t('hello', { name: profile.displayName })}</h1>
          <p className="text-sm text-foreground-muted">{t('who')}</p>
        </div>
      </header>
      {!profile.hasPin ? (
        <Card>
          <CardTitle>{t('noPin.title')}</CardTitle>
          <CardDescription className="mt-1">{t('noPin.body')}</CardDescription>
          <Button asChild variant="secondary" className="mt-3">
            <Link href="/settings">{t('noPin.action')}</Link>
          </Button>
        </Card>
      ) : null}
      {transfer.data?.transfer ? (
        <Card role="alert">
          <CardTitle>{t('transfer.title')}</CardTitle>
          <CardDescription className="mt-1">{t('transfer.body')}</CardDescription>
          <Button asChild className="mt-3">
            <Link href="/settings">{t('transfer.action')}</Link>
          </Button>
        </Card>
      ) : null}
      {waiting > 0 ? (
        <Card>
          <CardTitle>{t('waiting.title', { count: waiting })}</CardTitle>
          <Button asChild className="mt-3">
            <Link href="/circle">{t('waiting.action')}</Link>
          </Button>
        </Card>
      ) : null}
      <Card>
        <CardTitle>{t('soon.title')}</CardTitle>
        <CardDescription className="mt-1">{t('soon.body')}</CardDescription>
      </Card>
    </>
  );
}
