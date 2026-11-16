'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  CircleMemberViewSource,
  getListListsQueryKey,
  type ListCollectionViewItemsItem,
  ListScope,
  ListType,
  useCreateNewList,
  useGetCircle,
  useGetOwnProfile,
  useListLists,
  useRestoreOneList,
} from '@wishlist/api-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
import { listErrorKey } from './api-errors';

type Scope = (typeof ListScope)[keyof typeof ListScope];

function ListRow({ list, scope }: { list: ListCollectionViewItemsItem; scope: Scope }) {
  const t = useTranslations('lists');
  const queryClient = useQueryClient();
  const restore = useRestoreOneList();
  if (list.view === 'teaser') {
    // GFT-03, GFT-09 : l'existence seule.
    return (
      <Card>
        <CardTitle>{t('giftlist')}</CardTitle>
        <CardDescription className="mt-1">{t('teaser')}</CardDescription>
        {list.content !== 'NONE' ? (
          <Button asChild variant="secondary" className="mt-3">
            <Link href={`/lists/${list.id}`}>{t('open')}</Link>
          </Button>
        ) : null}
      </Card>
    );
  }
  const type = list.view === 'giver' ? list.type : ListType.WISHLIST;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{list.personal ? t('personal') : list.title}</CardTitle>
          <CardDescription className="mt-1">
            {type === ListType.GIFTLIST ? t('giftlist') : t('wishlist')} ·{' '}
            {t(`audience.${list.audience}`)}
            {list.myRole ? ` · ${t(`role.${list.myRole}`)}` : ''}
          </CardDescription>
        </div>
        {scope === ListScope.trash ? (
          <Button
            variant="secondary"
            disabled={restore.isPending}
            onClick={() => {
              restore.mutate(
                { id: list.id },
                {
                  onSuccess: () =>
                    void queryClient.invalidateQueries({ queryKey: getListListsQueryKey() }),
                },
              );
            }}
          >
            {t('restore')}
          </Button>
        ) : (
          <Button asChild variant="secondary">
            <Link href={`/lists/${list.id}`}>{t('open')}</Link>
          </Button>
        )}
      </div>
    </Card>
  );
}

/** LST-01, LST-07 : création ; dit toujours qui verra la liste (UX-04). */
function CreateListDialog() {
  const t = useTranslations('lists.create');
  const te = useTranslations('lists.errors');
  const router = useRouter();
  const create = useCreateNewList();
  const circle = useGetCircle();
  const profile = useGetOwnProfile();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ListType>(ListType.WISHLIST);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const members = circle.data?.items ?? [];
  // LST-07 : wishlist pour soi ou un profil de son compte ; giftlist pour son cercle.
  const choices =
    type === ListType.WISHLIST
      ? members.filter((m) => m.source === CircleMemberViewSource.ACCOUNT)
      : members;

  function toggle(id: string) {
    setRecipients((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = text(form, 'title').trim();
    const description = text(form, 'description').trim();
    const me = profile.data?.id;
    const chosen = type === ListType.WISHLIST && recipients.length === 0 && me ? [me] : recipients;
    setError(null);
    create.mutate(
      {
        data: {
          type,
          title,
          ...(description ? { description } : {}),
          ...(chosen.length > 0 ? { recipientIds: chosen } : {}),
        },
      },
      {
        onSuccess: (list) => {
          setOpen(false);
          router.push(`/lists/${list.id}`);
        },
        onError: (e) => {
          setError(te(listErrorKey(e)));
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
        <DialogDescription>
          {type === ListType.WISHLIST ? t('whoWishlist') : t('whoGiftlist')}
        </DialogDescription>
        <form className="mt-4 flex flex-col gap-4" onSubmit={onSubmit}>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('type')}</legend>
            {[ListType.WISHLIST, ListType.GIFTLIST].map((value) => (
              <label key={value} className="flex min-h-touch items-center gap-2">
                <input
                  type="radio"
                  name="type"
                  value={value}
                  checked={type === value}
                  onChange={() => {
                    setType(value);
                    setRecipients([]);
                  }}
                />
                {value === ListType.WISHLIST ? t('wishlist') : t('giftlist')}
              </label>
            ))}
          </fieldset>
          <Field label={t('name')} name="title" required maxLength={120} />
          <Field label={t('description')} name="description" maxLength={1000} />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('recipients')}</legend>
            <p className="text-sm text-foreground-muted">
              {type === ListType.WISHLIST ? t('recipientsWishlist') : t('recipientsGiftlist')}
            </p>
            {type === ListType.WISHLIST && profile.data ? (
              <label className="flex min-h-touch items-center gap-2">
                <input
                  type="checkbox"
                  checked={recipients.length === 0 || recipients.includes(profile.data.id)}
                  onChange={() => {
                    toggle(profile.data.id);
                  }}
                />
                {t('me')}
              </label>
            ) : null}
            {choices.map((member) => (
              <label key={member.profileId} className="flex min-h-touch items-center gap-2">
                <input
                  type="checkbox"
                  checked={recipients.includes(member.profileId)}
                  onChange={() => {
                    toggle(member.profileId);
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

/** Listes du profil actif et celles qu'on lui montre (LST-05, LST-20, WSH-06). */
export function ListsScreen() {
  const t = useTranslations('lists');
  const [scope, setScope] = useState<Scope>(ListScope.active);
  const lists = useListLists({ scope });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t('scope.label')} className="flex flex-wrap gap-1">
          {[ListScope.active, ListScope.archived, ListScope.trash].map((value) => (
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
        <CreateListDialog />
      </div>
      {scope === ListScope.trash ? (
        <p className="text-sm text-foreground-muted">{t('trashHint')}</p>
      ) : null}
      {lists.isPending ? (
        <Skeleton className="h-24 w-full" aria-label={t('loading')} />
      ) : (lists.data?.items.length ?? 0) === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {lists.data?.items.map((list) => (
            <li key={list.id}>
              <ListRow list={list} scope={scope} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
