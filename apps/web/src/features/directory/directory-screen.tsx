'use client';

import { ProfileImage } from '@/lib/offline/profile-image';
import {
  useAddListItem,
  useCopyFromDirectory,
  useGetCircle,
  useListLists,
  useSearchDirectory,
  useSearchGlobalCatalog,
} from '@wishlist/api-client';
import { useLocale, useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { listErrorKey } from '@/features/lists/api-errors';
import { formatMinor } from '@/features/lists/format';
import { ReportButton } from '@/features/moderation/report-button';

type Scope = 'circle' | 'global';

/**
 * Répertoire du cercle (REP-01 à REP-05, VIS-40) et catalogue ouvert à tous (MOD-05, MOD-12) : ce
 * que l'API montre, rien d'autre.
 */
export function DirectoryScreen() {
  const t = useTranslations('directory');
  const tc = useTranslations('catalog');
  const [scope, setScope] = useState<Scope>('circle');
  const te = useTranslations('lists.errors');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const directory = useSearchDirectory(query ? { q: query } : {}, {
    query: { enabled: scope === 'circle' },
  });
  const global = useSearchGlobalCatalog(query ? { q: query } : {}, {
    query: { enabled: scope === 'global' },
  });
  const entries =
    scope === 'circle'
      ? (directory.data?.items ?? []).map((e) => ({ ...e, adopters: null as number | null }))
      : (global.data?.items ?? []).map((e) => ({ ...e, sharedBy: null as string | null }));
  const loaded = scope === 'circle' ? directory.data : global.data;
  const circle = useGetCircle();
  const lists = useListLists({ scope: 'active' });
  const copy = useCopyFromDirectory();
  const add = useAddListItem();
  const [message, setMessage] = useState<string | null>(null);
  const names = new Map((circle.data?.items ?? []).map((m) => [m.profileId, m.displayName]));
  const personal = lists.data?.items.find((l) => l.view === 'recipient' && l.personal);

  function onSearch(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setQuery(text(new FormData(event.currentTarget), 'q').trim());
  }

  function addToWishes(productId: string) {
    if (!personal) return;
    setMessage(null);
    // REP-05 : une copie à moi, puis l'ajout à « Mes envies ».
    copy.mutate(
      { productId },
      {
        onSuccess: (copied) => {
          add.mutate(
            { id: personal.id, data: { productId: copied.productId } },
            {
              onSuccess: () => {
                setMessage(t('added'));
              },
              onError: (e) => {
                setMessage(te(listErrorKey(e)));
              },
            },
          );
        },
        onError: (e) => {
          setMessage(te(listErrorKey(e)));
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label={t('title')} className="flex gap-2">
        {(['circle', 'global'] as const).map((value) => (
          <Button
            key={value}
            role="tab"
            aria-selected={scope === value}
            variant={scope === value ? 'secondary' : 'ghost'}
            onClick={() => {
              setScope(value);
            }}
          >
            {tc(value)}
          </Button>
        ))}
      </div>
      {scope === 'global' ? (
        <p className="text-sm text-foreground-muted">{tc('globalWho')}</p>
      ) : null}
      <form role="search" className="flex flex-wrap items-end gap-2" onSubmit={onSearch}>
        <div className="min-w-0 flex-1">
          <Field
            label={t('search')}
            name="q"
            type="search"
            maxLength={100}
            placeholder={t('searchPlaceholder')}
          />
        </div>
        <Button type="submit">{t('search')}</Button>
      </form>
      {message ? <p role="status">{message}</p> : null}
      {loaded && entries.length === 0 ? <p>{t('empty')}</p> : null}
      <ul className="flex flex-col gap-3">
        {entries.map((entry) => (
          <li
            key={entry.productId}
            className="flex gap-4 rounded-lg border border-border bg-surface p-4"
          >
            {entry.imageKey ? (
              <ProfileImage
                imageKey={entry.imageKey}
                width={80}
                height={80}
                className="size-20 rounded-md object-cover"
              />
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 className="font-semibold break-words">{entry.title}</h2>
              {entry.unitPriceMinor !== null ? (
                <p className="text-sm">
                  {formatMinor(entry.unitPriceMinor, entry.currency, locale)}
                </p>
              ) : null}
              <p className="text-sm text-foreground-muted">
                {entry.sharedBy !== null
                  ? t('sharedBy', { name: names.get(entry.sharedBy) ?? '…' })
                  : tc('adopters', { count: entry.adopters ?? 0 })}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={!personal || copy.isPending || add.isPending}
                  onClick={() => {
                    addToWishes(entry.productId);
                  }}
                >
                  {t('add')}
                </Button>
                <ReportButton targetKind="PRODUCT" targetId={entry.productId} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
