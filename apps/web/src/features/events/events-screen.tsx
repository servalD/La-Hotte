'use client';

import {
  EventScope,
  EventType,
  type EventSummaryView,
  useCreateNewEvent,
  useGetCircle,
  useListEvents,
} from '@wishlist/api-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { eventErrorKey } from './api-errors';
import { formatDay } from './format';

type Scope = (typeof EventScope)[keyof typeof EventScope];
type Type = (typeof EventType)[keyof typeof EventType];

const TYPES: Type[] = [
  EventType.CHRISTMAS,
  EventType.BIRTHDAY,
  EventType.BIRTH,
  EventType.WEDDING,
  EventType.OTHER,
];

/** Valeurs par défaut de 05 : échange pour Noël, à l'honneur pour les autres. */
function honoreeByDefault(type: Type): boolean {
  return type !== EventType.CHRISTMAS && type !== EventType.OTHER;
}

function EventRow({ event }: { event: EventSummaryView }) {
  const t = useTranslations('events');
  const locale = useLocale();
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{event.title}</CardTitle>
          <CardDescription className="mt-1">
            {formatDay(event.date, locale)} · {t(`type.${event.type}`)}
            {event.isSurprise ? ` · ${t('surprise')}` : ''}
            {event.status !== 'UPCOMING' ? ` · ${t(`status.${event.status}`)}` : ''}
          </CardDescription>
          <p className="mt-1 text-sm">{t(`rsvp.${event.myRsvp}`)}</p>
        </div>
        <Button asChild variant="secondary">
          <Link href={`/events/${event.id}`}>{t('open')}</Link>
        </Button>
      </div>
    </Card>
  );
}

/** EVT-01 à EVT-09 : création ; dit qui verra l'événement (UX-04). */
function CreateEventDialog() {
  const t = useTranslations('events.create');
  const te = useTranslations('events.errors');
  const tt = useTranslations('events.type');
  const router = useRouter();
  const create = useCreateNewEvent();
  const circle = useGetCircle();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<Type>(EventType.CHRISTMAS);
  const [honored, setHonored] = useState(false);
  const [surprise, setSurprise] = useState(false);
  const [honorees, setHonorees] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const honoreeMode = honored || honoreeByDefault(type);

  function toggle(id: string) {
    setHonorees((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const place = text(form, 'place').trim();
    const description = text(form, 'description').trim();
    setError(null);
    create.mutate(
      {
        data: {
          title: text(form, 'title').trim(),
          date: text(form, 'date'),
          type,
          mode: honoreeMode ? 'HONOREE' : 'EXCHANGE',
          isSurprise: honoreeMode && surprise,
          ...(place ? { place } : {}),
          ...(description ? { description } : {}),
          ...(honoreeMode ? { honoreeIds: honorees } : {}),
        },
      },
      {
        onSuccess: (created) => {
          setOpen(false);
          router.push(`/events/${created.id}`);
        },
        onError: (e) => {
          setError(te(eventErrorKey(e)));
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{t('action')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{surprise ? t('whoSurprise') : t('who')}</DialogDescription>
        <form className="mt-4 flex flex-col gap-4" onSubmit={onSubmit}>
          <Field label={t('name')} name="title" required maxLength={120} />
          <Field label={t('date')} name="date" type="date" required />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="event-type" className="text-sm font-medium">
              {t('type')}
            </label>
            <select
              id="event-type"
              className="min-h-touch rounded-md border border-border bg-surface px-3"
              value={type}
              onChange={(e) => {
                setType(e.target.value as Type);
                setHonorees([]);
              }}
            >
              {TYPES.map((value) => (
                <option key={value} value={value}>
                  {tt(value)}
                </option>
              ))}
            </select>
          </div>
          {!honoreeByDefault(type) ? (
            <label className="flex min-h-touch items-center gap-2">
              <input
                type="checkbox"
                checked={honored}
                onChange={() => {
                  setHonored(!honored);
                }}
              />
              {t('honoreeMode')}
            </label>
          ) : null}
          {honoreeMode ? (
            <>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">{t('honorees')}</legend>
                <p className="text-sm text-foreground-muted">{t('honoreesHint')}</p>
                {(circle.data?.items ?? []).map((member) => (
                  <label key={member.profileId} className="flex min-h-touch items-center gap-2">
                    <input
                      type="checkbox"
                      checked={honorees.includes(member.profileId)}
                      onChange={() => {
                        toggle(member.profileId);
                      }}
                    />
                    {member.displayName}
                  </label>
                ))}
              </fieldset>
              <label className="flex min-h-touch items-center gap-2">
                <input
                  type="checkbox"
                  checked={surprise}
                  onChange={() => {
                    setSurprise(!surprise);
                  }}
                />
                {t('surprise')}
              </label>
              {surprise ? (
                <p className="text-sm text-foreground-muted">{t('surpriseHint')}</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-foreground-muted">{t('exchangeHint')}</p>
          )}
          <Field label={t('place')} name="place" maxLength={200} />
          <Field label={t('description')} name="description" maxLength={2000} />
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {t('submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** EVT-08 : événements où le profil a une ligne de participant. */
export function EventsScreen() {
  const t = useTranslations('events');
  const [scope, setScope] = useState<Scope>(EventScope.upcoming);
  const events = useListEvents({ scope });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t('scope.label')} className="flex flex-wrap gap-1">
          {[EventScope.upcoming, EventScope.past].map((value) => (
            <Button
              key={value}
              variant={scope === value ? 'primary' : 'ghost'}
              aria-pressed={scope === value}
              onClick={() => {
                setScope(value);
              }}
            >
              {t(`scope.${value}`)}
            </Button>
          ))}
        </div>
        <CreateEventDialog />
      </div>
      {events.isPending ? (
        <Skeleton className="h-24 w-full" aria-label={t('loading')} />
      ) : (events.data?.items.length ?? 0) === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {events.data?.items.map((event) => (
            <li key={event.id}>
              <EventRow event={event} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
