'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  type EventDetailView,
  getGetEventProgressQueryKey,
  getGetOneEventQueryKey,
  getListEventLinksQueryKey,
  getListEventsQueryKey,
  getListListsQueryKey,
  RsvpAnswer,
  useCancelOneEvent,
  useCreateEventLink,
  useDeleteOneEvent,
  useGetCircle,
  useGetEventProgress,
  useGetOneEvent,
  useInviteEventParticipants,
  useListEventLinks,
  useListLists,
  useRecreateOneEvent,
  useRespondToEvent,
  useRevokeEventLink,
} from '@wishlist/api-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
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
import { eventErrorKey } from './api-errors';
import { formatDay } from './format';

type Answer = (typeof RsvpAnswer)[keyof typeof RsvpAnswer];

function useRefresh(id: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: getGetOneEventQueryKey(id) });
    void queryClient.invalidateQueries({ queryKey: getListEventsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListListsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetEventProgressQueryKey(id) });
  };
}

/** EVT-13, EVT-20, EVT-36 : répondre ; `Participe` ouvre l'assistant sur sa liste. */
function RsvpPanel({ event }: { event: EventDetailView }) {
  const t = useTranslations('events.rsvp');
  const te = useTranslations('events.errors');
  const router = useRouter();
  const refresh = useRefresh(event.id);
  const respond = useRespondToEvent();
  const [error, setError] = useState<string | null>(null);
  if (!event.permissions.respond) return null;
  return (
    <section aria-labelledby="rsvp-title" className="flex flex-col gap-2">
      <h2 id="rsvp-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <div role="group" aria-label={t('title')} className="flex flex-wrap gap-2">
        {[RsvpAnswer.YES, RsvpAnswer.MAYBE, RsvpAnswer.NO].map((answer: Answer) => (
          <Button
            key={answer}
            variant={event.myRsvp === answer ? 'primary' : 'secondary'}
            aria-pressed={event.myRsvp === answer}
            disabled={respond.isPending}
            onClick={() => {
              setError(null);
              respond.mutate(
                { id: event.id, data: { rsvp: answer } },
                {
                  onSuccess: (result) => {
                    refresh();
                    if (result.listId) {
                      router.push(`/events/${event.id}/assistant?list=${result.listId}`);
                    }
                  },
                  onError: (e) => {
                    setError(te(eventErrorKey(e)));
                  },
                },
              );
            }}
          >
            {t(answer)}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** EVT-15 : inviter des profils de son cercle. */
function InviteDialog({ event }: { event: EventDetailView }) {
  const t = useTranslations('events.invite');
  const te = useTranslations('events.errors');
  const circle = useGetCircle();
  const invite = useInviteEventParticipants();
  const refresh = useRefresh(event.id);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const present = new Set(event.participants.map((p) => p.profileId));
  const honored = new Set((event.surpriseHonorees ?? []).map((p) => p.profileId));
  const choices = (circle.data?.items ?? []).filter(
    (m) => !present.has(m.profileId) && !honored.has(m.profileId),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">{t('action')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('who')}</DialogDescription>
        <fieldset className="mt-4 flex flex-col gap-2">
          <legend className="sr-only">{t('title')}</legend>
          {choices.length === 0 ? <p>{t('empty')}</p> : null}
          {choices.map((member) => (
            <label key={member.profileId} className="flex min-h-touch items-center gap-2">
              <input
                type="checkbox"
                checked={chosen.includes(member.profileId)}
                onChange={() => {
                  setChosen((c) =>
                    c.includes(member.profileId)
                      ? c.filter((x) => x !== member.profileId)
                      : [...c, member.profileId],
                  );
                }}
              />
              {member.displayName}
            </label>
          ))}
        </fieldset>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end">
          <Button
            disabled={chosen.length === 0 || invite.isPending}
            onClick={() => {
              setError(null);
              invite.mutate(
                { id: event.id, data: { profileIds: chosen } },
                {
                  onSuccess: () => {
                    refresh();
                    setChosen([]);
                    setOpen(false);
                  },
                  onError: (e) => {
                    setError(te(eventErrorKey(e)));
                  },
                },
              );
            }}
          >
            {t('submit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** EVT-16 : liens d'invitation ; le jeton n'est montré qu'à la création, dans le fragment. */
function LinksPanel({ event }: { event: EventDetailView }) {
  const t = useTranslations('events.links');
  const te = useTranslations('events.errors');
  const queryClient = useQueryClient();
  const links = useListEventLinks(event.id, { query: { enabled: event.permissions.manageLinks } });
  const create = useCreateEventLink();
  const revoke = useRevokeEventLink();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!event.permissions.manageLinks) return null;
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getListEventLinksQueryKey(event.id) });
  return (
    <section aria-labelledby="links-title" className="flex flex-col gap-2">
      <h2 id="links-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p className="text-sm text-foreground-muted">{t('who')}</p>
      {event.permissions.createLink ? (
        <Button
          className="self-start"
          variant="secondary"
          disabled={create.isPending}
          onClick={() => {
            setError(null);
            create.mutate(
              { id: event.id, data: {} },
              {
                onSuccess: (created) => {
                  setUrl(`${window.location.origin}/events/join#${created.token}`);
                  refresh();
                },
                onError: (e) => {
                  setError(te(eventErrorKey(e)));
                },
              },
            );
          }}
        >
          {t('create')}
        </Button>
      ) : null}
      {url ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="event-link" className="text-sm font-medium">
            {t('copy')}
          </label>
          <input
            id="event-link"
            readOnly
            value={url}
            className="min-h-touch rounded-md border border-border bg-surface px-3"
            onFocus={(e) => {
              e.currentTarget.select();
            }}
          />
          <p className="text-sm text-foreground-muted">{t('once')}</p>
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {(links.data?.items ?? []).map((link) => (
          <li key={link.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              {t('uses', { used: link.usedCount, max: link.maxUses })}
            </span>
            <Button
              variant="ghost"
              disabled={revoke.isPending}
              onClick={() => {
                revoke.mutate({ id: event.id, linkId: link.id }, { onSuccess: refresh });
              }}
            >
              {t('revoke')}
            </Button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** EVT-30, EVT-31 : calculés par le serveur sur les seules listes vues en offreur (EVT-37). */
function ProgressPanel({ event }: { event: EventDetailView }) {
  const t = useTranslations('events.progress');
  const progress = useGetEventProgress(event.id);
  const data = progress.data;
  if (!data || data.recipients.length === 0) return null;
  const names = new Map(
    [...event.participants, ...(event.surpriseHonorees ?? [])].map((p) => [
      p.profileId,
      p.displayName,
    ]),
  );
  return (
    <section aria-labelledby="progress-title" className="flex flex-col gap-2">
      <h2 id="progress-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p>{t('count', { given: data.itemsWithGiver, total: data.itemsTotal })}</p>
      {data.recipientsWithoutGiver.length > 0 ? (
        <>
          <h3 className="font-medium">{t('nobodyYet')}</h3>
          <ul className="list-disc pl-5">
            {data.recipientsWithoutGiver.map((id) => (
              <li key={id}>{names.get(id) ?? t('someone')}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>{t('everyone')}</p>
      )}
      <p className="text-sm text-foreground-muted">{t('who')}</p>
    </section>
  );
}

function ListsPanel({ event }: { event: EventDetailView }) {
  const t = useTranslations('events.lists');
  const lists = useListLists({ scope: 'active', eventId: event.id });
  const items = lists.data?.items ?? [];
  const mine = items.filter((l) => l.view === 'recipient');
  const passed = event.datePassed || event.status !== 'UPCOMING';
  return (
    <section aria-labelledby="lists-title" className="flex flex-col gap-2">
      <h2 id="lists-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      {passed && mine.length > 0 ? (
        // EVT-32 : cocher ce qu'on a reçu (sans indication de ce qui a été acheté).
        <p className="text-sm">{t('reception')}</p>
      ) : null}
      {items.length === 0 ? <p>{t('empty')}</p> : null}
      <ul className="flex flex-col gap-2">
        {items.map((list) =>
          list.view === 'teaser' ? null : (
            <li key={list.id}>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{list.title}</CardTitle>
                  <Button asChild variant="secondary">
                    <Link href={`/lists/${list.id}`}>
                      {list.view === 'recipient' ? t('mine') : t('open')}
                    </Link>
                  </Button>
                </div>
              </Card>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function OrganizerActions({ event }: { event: EventDetailView }) {
  const t = useTranslations('events.manage');
  const te = useTranslations('events.errors');
  const router = useRouter();
  const refresh = useRefresh(event.id);
  const cancel = useCancelOneEvent();
  const recreate = useRecreateOneEvent();
  const remove = useDeleteOneEvent();
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => {
    setError(te(eventErrorKey(e)));
  };
  const p = event.permissions;
  if (!p.invite && !p.cancel && !p.recreate && !p.delete) return null;
  return (
    <section aria-labelledby="manage-title" className="flex flex-col gap-2">
      <h2 id="manage-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <div className="flex flex-wrap gap-2">
        {p.invite ? <InviteDialog event={event} /> : null}
        {p.recreate ? (
          <Button
            variant="secondary"
            disabled={recreate.isPending}
            onClick={() => {
              recreate.mutate(
                { id: event.id },
                {
                  onSuccess: (created) => {
                    refresh();
                    router.push(`/events/${created.id}`);
                  },
                  onError,
                },
              );
            }}
          >
            {t('recreate')}
          </Button>
        ) : null}
        {p.cancel ? (
          <Button
            variant="ghost"
            disabled={cancel.isPending}
            onClick={() => {
              if (!window.confirm(t('cancelConfirm'))) return;
              cancel.mutate({ id: event.id }, { onSuccess: refresh, onError });
            }}
          >
            {t('cancel')}
          </Button>
        ) : null}
        {p.delete ? (
          <Button
            variant="ghost"
            disabled={remove.isPending}
            onClick={() => {
              if (!window.confirm(t('deleteConfirm'))) return;
              remove.mutate(
                { id: event.id },
                {
                  onSuccess: () => {
                    refresh();
                    router.push('/events');
                  },
                  onError,
                },
              );
            }}
          >
            {t('delete')}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Page d'un événement (EVT-08, EVT-30) : la même pour tous ses participants. */
export function EventScreen({ id }: { id: string }) {
  const t = useTranslations('events');
  const locale = useLocale();
  const query = useGetOneEvent(id);
  if (query.isPending) return <Skeleton className="h-32 w-full" aria-label={t('loading')} />;
  if (!query.data) return <p role="alert">{t('notFound')}</p>;
  const event = query.data;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{event.title}</h1>
        <p className="text-foreground-muted">
          {formatDay(event.date, locale)} · {t(`type.${event.type}`)} · {t(`mode.${event.mode}`)}
          {event.isSurprise ? ` · ${t('surprise')}` : ''}
          {event.status !== 'UPCOMING' ? ` · ${t(`status.${event.status}`)}` : ''}
        </p>
        {event.place ? <p>{event.place}</p> : null}
        {event.description ? <p className="whitespace-pre-line">{event.description}</p> : null}
        <p className="text-sm text-foreground-muted">
          {event.isSurprise ? t('whoSurprise') : t('who')}
        </p>
      </header>
      {event.sharedAccountWarning ? (
        <p role="note" className="rounded-md border border-border p-3 text-sm">
          {t('sharedAccount')}
        </p>
      ) : null}
      <RsvpPanel event={event} />
      <section aria-labelledby="people-title" className="flex flex-col gap-2">
        <h2 id="people-title" className="text-lg font-semibold">
          {t('participants')}
        </h2>
        {event.surpriseHonorees && event.surpriseHonorees.length > 0 ? (
          <p>
            {t('surpriseFor', {
              names: event.surpriseHonorees.map((p) => p.displayName).join(', '),
            })}
          </p>
        ) : null}
        <ul className="flex flex-col gap-1">
          {event.participants.map((p) => (
            <li key={p.profileId}>
              <Card>
                <CardTitle className="text-base">{p.displayName}</CardTitle>
                <CardDescription>
                  {t(`rsvp.${p.rsvp}`)}
                  {p.role === 'ORGANIZER' ? ` · ${t('organizer')}` : ''}
                  {p.isHonoree ? ` · ${t('honoree')}` : ''}
                </CardDescription>
              </Card>
            </li>
          ))}
        </ul>
      </section>
      <ListsPanel event={event} />
      <ProgressPanel event={event} />
      <OrganizerActions event={event} />
      <LinksPanel event={event} />
    </div>
  );
}
