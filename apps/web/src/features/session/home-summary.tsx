'use client';

import {
  EventScope,
  useGetBalances,
  useGetOwnProfile,
  useGetOwnTransfer,
  useListEvents,
  useListItems,
  useListLists,
  useListLinks,
} from '@wishlist/api-client';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  CalendarIcon,
  ChevronRightIcon,
  GiftIcon,
  ShieldIcon,
  UsersIcon,
  WalletIcon,
} from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDay } from '@/features/events/format';
import { formatMinor } from '@/features/lists/format';
import { ProfileAvatar } from '@/features/profiles/profile-avatar';
import { cn } from '@/lib/utils/cn';

/** Accueil d'un profil de la phase 1 : qui je suis, ce qui attend ma validation. */
export function HomeSummary() {
  const t = useTranslations('home');
  const te = useTranslations('events');
  const { data: profile } = useGetOwnProfile();
  const links = useListLinks();
  const transfer = useGetOwnTransfer();
  const locale = useLocale();
  const events = useListEvents({ scope: EventScope.upcoming });
  const balances = useGetBalances();
  const lists = useListLists({ scope: 'active' });
  // UX-11 : la liste personnelle du profil (wishlist « Mes envies »).
  const personal = lists.data?.items.find((l) => l.view !== 'teaser' && l.personal);
  const waiting = links.data?.items.filter((l) => l.awaitingMyApproval).length ?? 0;

  if (!profile) return <Skeleton className="h-24 w-full" />;

  // UX-10 : « parts à régler ». Les montants restent des entiers par devise (ART-11).
  const owedByCurrency = new Map<string, number>();
  let owedPeople = 0;
  for (const balance of balances.data?.items ?? []) {
    if (balance.netMinor <= 0) continue;
    owedPeople += 1;
    owedByCurrency.set(
      balance.currency,
      (owedByCurrency.get(balance.currency) ?? 0) + balance.netMinor,
    );
  }
  const owed = [...owedByCurrency].map(([currency, minor]) => ({ currency, minor }));
  // UX-10 : les trois prochains événements.
  const soon = (events.data?.items ?? []).slice(0, 3);
  const hasTransfer = Boolean(transfer.data?.transfer);
  const hasLink = (links.data?.items.length ?? 0) > 0;
  // DS-08 : une seule action principale par écran ; ce qui attend une décision passe avant les listes.
  const urgent = hasTransfer || waiting > 0;

  return (
    <>
      <header className="flex items-center gap-4">
        <ProfileAvatar name={profile.displayName} color={profile.accentColor} size={64} />
        <div>
          <h1 className="text-3xl font-semibold">{t('hello', { name: profile.displayName })}</h1>
          <p className="text-sm text-foreground-muted">{t('who')}</p>
        </div>
      </header>
      <div className="flex flex-col gap-4">
        {hasTransfer ? (
          <HomeCard
            role="alert"
            icon={<UsersIcon />}
            title={t('transfer.title')}
            description={t('transfer.body')}
            highlight
          >
            <Button asChild>
              <Link href="/settings">{t('transfer.action')}</Link>
            </Button>
          </HomeCard>
        ) : null}
        {waiting > 0 ? (
          <HomeCard icon={<UsersIcon />} title={t('waiting.title', { count: waiting })} highlight>
            <Button asChild>
              <Link href="/circle">{t('waiting.action')}</Link>
            </Button>
          </HomeCard>
        ) : null}
        {personal && links.data ? <GuidedStart listId={personal.id} hasLink={hasLink} /> : null}
        {owed.length > 0 ? (
          <HomeCard
            icon={<WalletIcon />}
            title={t('owe.title', {
              amount: owed.map((o) => formatMinor(o.minor, o.currency, locale)).join(' · '),
            })}
            description={t('owe.body', { count: owedPeople })}
          >
            <Button asChild variant="secondary">
              <Link href="/balances">{t('owe.action')}</Link>
            </Button>
          </HomeCard>
        ) : null}
        {soon.length > 0 ? (
          <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{t('events.title')}</CardTitle>
              <Link
                href="/events"
                className="inline-flex min-h-touch items-center text-sm font-medium text-primary"
              >
                {t('events.all')}
              </Link>
            </div>
            <ul className="flex flex-col">
              {soon.map((event) => (
                <li key={event.id} className="relative flex items-center gap-3 py-2">
                  <span
                    aria-hidden="true"
                    className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-primary"
                  >
                    <CalendarIcon />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/events/${event.id}`}
                      className="block truncate font-medium after:absolute after:inset-0"
                    >
                      {event.title}
                    </Link>
                    <p className="text-sm text-foreground-muted">{formatDay(event.date, locale)}</p>
                  </div>
                  {event.myRsvp === 'PENDING' ? (
                    <Badge tone="accent">{te(`rsvp.${event.myRsvp}`)}</Badge>
                  ) : null}
                  <ChevronRightIcon className="text-foreground-muted" aria-hidden="true" />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        <HomeCard icon={<GiftIcon />} title={t('soon.title')} description={t('soon.body')}>
          <Button asChild variant={urgent ? 'secondary' : 'primary'}>
            <Link href="/lists">{t('soon.action')}</Link>
          </Button>
        </HomeCard>
        {!profile.hasPin ? (
          <HomeCard icon={<ShieldIcon />} title={t('noPin.title')} description={t('noPin.body')}>
            <Button asChild variant="secondary">
              <Link href="/settings">{t('noPin.action')}</Link>
            </Button>
          </HomeCard>
        ) : null}
      </div>
    </>
  );
}

/** Carte d'accueil : pastille d'icône, texte, une action. `highlight` marque ce qui attend une décision. */
function HomeCard({
  icon,
  title,
  description,
  highlight = false,
  children,
  ...props
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  highlight?: boolean;
  children: ReactNode;
} & Omit<ComponentProps<typeof Card>, 'title'>) {
  return (
    <Card
      className={cn('flex items-start gap-4', highlight && 'border-accent bg-accent/10')}
      {...props}
    >
      <span
        aria-hidden="true"
        className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-primary"
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
        </div>
        {children}
      </div>
    </Card>
  );
}

/**
 * UX-11 : parcours guidé d'un nouveau profil. Deux cartes qui se cochent d'elles-mêmes : premier
 * souhait, premier proche. L'installation de l'application est proposée au bon moment par
 * `InstallInvite` (PWA-03), pas ici. La carte disparaît quand tout est fait.
 */
function GuidedStart({ listId, hasLink }: { listId: string; hasLink: boolean }) {
  const t = useTranslations('home.guide');
  const items = useListItems(listId, { sort: 'position' });
  if (!items.data) return null;
  const steps = [
    {
      key: 'wish',
      done: items.data.items.length > 0,
      href: `/lists/${listId}`,
      icon: <GiftIcon />,
    },
    { key: 'invite', done: hasLink, href: '/invitations', icon: <UsersIcon /> },
  ] as const;
  if (steps.every((step) => step.done)) return null;
  return (
    <Card className="flex flex-col gap-4 border-accent bg-accent/10">
      <CardTitle>{t('title')}</CardTitle>
      <ol className="flex flex-col gap-3">
        {steps.map((step) => (
          <li key={step.key} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-surface text-primary"
            >
              {step.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t(`${step.key}.title`)}</p>
              <p className="text-sm text-foreground-muted">{t(`${step.key}.body`)}</p>
            </div>
            {step.done ? (
              <Badge tone="success">
                <span aria-hidden="true">✓ </span>
                {t('done')}
              </Badge>
            ) : (
              <Button asChild variant="secondary">
                <Link href={step.href}>{t(`${step.key}.action`)}</Link>
              </Button>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}
