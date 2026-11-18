'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  getListCarryCandidatesQueryKey,
  useAddListItem,
  useCarryOverItems,
  useCopyItemProduct,
  useListCarryCandidates,
  useSearchEventIdeas,
} from '@wishlist/api-client';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { type SyntheticEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { eventErrorKey } from './api-errors';
import { formatDay } from './format';

type Step = 1 | 2 | 3;

/** Étape 1 (EVT-21, EVT-22) : souhaits non obtenus, tous présélectionnés, à décocher. */
function CarryStep({
  eventId,
  listId,
  next,
}: {
  eventId: string;
  listId: string;
  next: () => void;
}) {
  const t = useTranslations('events.assistant.carry');
  const te = useTranslations('events.errors');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const candidates = useListCarryCandidates(eventId);
  const carry = useCarryOverItems();
  const items = candidates.data?.items ?? [];
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const chosen = items.map((c) => c.item.id).filter((id) => !unchecked.has(id));

  if (candidates.isPending) return <Skeleton className="h-24 w-full" aria-label={t('loading')} />;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-foreground-muted">{t('who')}</p>
      {items.length === 0 ? <EmptyState compact title={t('empty')} /> : null}
      <ul className="flex flex-col gap-2">
        {items.map((c) => (
          <li key={c.item.id} className="flex min-h-touch items-start gap-3">
            <input
              id={`carry-${c.item.id}`}
              aria-describedby={`carry-${c.item.id}-from`}
              type="checkbox"
              className="mt-1"
              checked={!unchecked.has(c.item.id)}
              onChange={() => {
                setUnchecked((current) => {
                  const copy = new Set(current);
                  if (copy.has(c.item.id)) copy.delete(c.item.id);
                  else copy.add(c.item.id);
                  return copy;
                });
              }}
            />
            <span>
              <label htmlFor={`carry-${c.item.id}`} className="font-medium">
                {c.item.product.title}
              </label>
              <span id={`carry-${c.item.id}-from`} className="block text-sm text-foreground-muted">
                {t('from', { title: c.event.title, date: formatDay(c.event.date, locale) })}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {chosen.length > 0 ? (
          <Button
            disabled={carry.isPending}
            onClick={() => {
              setError(null);
              carry.mutate(
                { id: eventId, data: { listId, itemIds: chosen } },
                {
                  onSuccess: () => {
                    void queryClient.invalidateQueries({
                      queryKey: getListCarryCandidatesQueryKey(eventId),
                    });
                    next();
                  },
                  onError: (e) => {
                    setError(te(eventErrorKey(e)));
                  },
                },
              );
            }}
          >
            {t('submit', { count: chosen.length })}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={next}>
          {t('skip')}
        </Button>
      </div>
    </div>
  );
}

/** Étape 2 (EVT-20, EVT-23) : piocher dans « Mes envies » et les listes des autres ; copie. */
function IdeasStep({
  eventId,
  listId,
  next,
}: {
  eventId: string;
  listId: string;
  next: () => void;
}) {
  const t = useTranslations('events.assistant.ideas');
  const te = useTranslations('events.errors');
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const ideas = useSearchEventIdeas(eventId, { q }, { query: { enabled: q.length > 0 } });
  const copy = useCopyItemProduct();
  const add = useAddListItem();
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function search(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setQ(draft.trim());
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-foreground-muted">{t('who')}</p>
      <form onSubmit={search} className="flex flex-wrap items-end gap-2" role="search">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ideas-q">{t('search')}</Label>
          <Input
            id="ideas-q"
            value={draft}
            maxLength={100}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
          />
        </div>
        <Button type="submit" variant="secondary">
          {t('submit')}
        </Button>
      </form>
      {q && ideas.data?.items.length === 0 ? <EmptyState compact title={t('empty')} /> : null}
      <ul className="flex flex-col gap-2">
        {(ideas.data?.items ?? []).map((item) => (
          <li key={item.id}>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{item.product.title}</CardTitle>
                  {item.product.merchant ? (
                    <CardDescription>{item.product.merchant}</CardDescription>
                  ) : null}
                </div>
                <Button
                  variant="secondary"
                  disabled={added.has(item.id) || copy.isPending || add.isPending}
                  onClick={() => {
                    setError(null);
                    copy.mutate(
                      { id: item.id },
                      {
                        onSuccess: (copied) => {
                          add.mutate(
                            { id: listId, data: { productId: copied.productId } },
                            {
                              onSuccess: () => {
                                setAdded((s) => new Set(s).add(item.id));
                              },
                              onError: (e) => {
                                setError(te(eventErrorKey(e)));
                              },
                            },
                          );
                        },
                        onError: (e) => {
                          setError(te(eventErrorKey(e)));
                        },
                      },
                    );
                  }}
                >
                  {added.has(item.id) ? t('added') : t('add')}
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button className="self-start" variant="secondary" onClick={next}>
        {t('next')}
      </Button>
    </div>
  );
}

/**
 * Assistant de réponse (EVT-20, EVT-25) : trois étapes facultatives ; la liste existe déjà (EVT-36)
 * et se complète plus tard. On peut le quitter à tout moment.
 */
export function EventAssistant({ eventId, listId }: { eventId: string; listId: string | null }) {
  const t = useTranslations('events.assistant');
  const [step, setStep] = useState<Step>(1);
  const [heading, setHeading] = useState<HTMLHeadingElement | null>(null);
  useEffect(() => {
    heading?.focus();
  }, [step, heading]);
  if (!listId) return <p role="alert">{t('noList')}</p>;
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t('steps')}>
        <ol className="flex flex-wrap gap-3 text-sm">
          {([1, 2, 3] as const).map((n) => (
            <li
              key={n}
              aria-current={step === n ? 'step' : undefined}
              className={step === n ? 'font-semibold' : ''}
            >
              {t(`step${n}`)}
            </li>
          ))}
        </ol>
      </nav>
      <h2 ref={setHeading} tabIndex={-1} className="text-xl font-semibold">
        {t(`step${step}`)}
      </h2>
      {step === 1 ? (
        <CarryStep
          eventId={eventId}
          listId={listId}
          next={() => {
            setStep(2);
          }}
        />
      ) : step === 2 ? (
        <IdeasStep
          eventId={eventId}
          listId={listId}
          next={() => {
            setStep(3);
          }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p>{t('newHint')}</p>
          <Button asChild className="self-start">
            <Link href={`/lists/${listId}`}>{t('toList')}</Link>
          </Button>
        </div>
      )}
      <Button asChild variant="ghost" className="self-start">
        <Link href={`/events/${eventId}`}>{t('leave')}</Link>
      </Button>
    </div>
  );
}
