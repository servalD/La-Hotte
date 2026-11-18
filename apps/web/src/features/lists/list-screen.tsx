'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  AddRight,
  GiftContent,
  GiftExistence,
  getGetOneListQueryKey,
  getListListsQueryKey,
  getListMembersQueryKey,
  type ItemSort,
  type ListGiverView,
  type ListRecipientView,
  ListType,
  MemberRoleChoice,
  useDeleteOneList,
  useGetCircle,
  useGetOneList,
  useGetOwnProfile,
  useLeaveList,
  useListItems,
  useListMembers,
  useRemoveListMember,
  useSetListMember,
  useUpdateOneList,
} from '@wishlist/api-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ChevronRightIcon, PlusIcon } from '@/components/ui/icons';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { AddItemPanel } from './add-item-panel';
import { listErrorKey } from './api-errors';
import { ItemCard } from './item-card';

const SORTS = ['position', 'priority', 'price', 'added'] as const;

/** Une liste et ses éléments, sous la forme que l'API rend au profil actif (VIS-30). */
export function ListScreen({ id }: { id: string }) {
  const t = useTranslations('list');
  const tl = useTranslations('lists');
  const ta = useTranslations('add');
  const list = useGetOneList(id);
  const circle = useGetCircle();
  const me = useGetOwnProfile();
  const [adding, setAdding] = useState(false);
  const [sort, setSort] = useState<ItemSort>('position');
  const items = useListItems(id, { sort });

  if (list.isPending) return <Skeleton className="h-32 w-full" aria-label={t('loading')} />;
  if (list.isError) return <p role="alert">{tl(`errors.${listErrorKey(list.error)}`)}</p>;
  const data = list.data;

  if (data.view === 'teaser') {
    return (
      <>
        <Card>
          <CardTitle>{tl('giftlist')}</CardTitle>
          <CardDescription className="mt-1">{tl('teaser')}</CardDescription>
        </Card>
        <ul className="flex flex-col gap-3">
          {items.data?.items.map((item) => (
            <li key={item.id}>
              <ItemCard item={item} listId={id} isGiftlist permissions={NO_PERMISSIONS} />
            </li>
          ))}
        </ul>
      </>
    );
  }

  const isGiftlist = data.view === 'giver' && data.type === ListType.GIFTLIST;
  const names = new Map((circle.data?.items ?? []).map((m) => [m.profileId, m.displayName]));
  // Le profil actif n'est pas dans son propre cercle : son nom vient de son profil.
  if (me.data) names.set(me.data.id, me.data.displayName);
  const recipientNames = data.recipients.map((r) => names.get(r) ?? '…').join(', ');
  const readOnly = data.archivedAt !== null || data.deletedAt !== null;

  const canAdd = !readOnly && data.permissions.add !== AddRight.none;
  const addLabel =
    data.permissions.add === AddRight.suggestion
      ? 'titleSuggestion'
      : isGiftlist
        ? 'titleGift'
        : 'title';
  const addButton = canAdd ? (
    <Button
      variant={adding ? 'secondary' : 'primary'}
      aria-expanded={adding}
      onClick={() => {
        setAdding((open) => !open);
      }}
    >
      {adding ? null : <PlusIcon width={18} height={18} />}
      {adding ? t('cancel') : ta(addLabel)}
    </Button>
  ) : null;
  const empty = items.data?.items.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/lists"
        className="inline-flex min-h-touch items-center gap-1 self-start rounded-md text-sm font-medium text-foreground-muted hover:text-foreground"
      >
        <ChevronRightIcon width={16} height={16} className="rotate-180" />
        {t('back')}
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold break-words">
          {data.personal ? tl('personal') : data.title}
        </h1>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={isGiftlist ? 'accent' : 'brand'}>
            {isGiftlist ? tl('giftlist') : tl('wishlist')}
          </Badge>
          {/* UX-04 : toujours dire qui voit. */}
          <Badge>{tl(`audience.${data.audience}`)}</Badge>
        </div>
        {recipientNames ? (
          <p className="text-sm">{t('recipients', { names: recipientNames })}</p>
        ) : null}
        {data.description ? <p className="mt-1 break-words">{data.description}</p> : null}
        {data.archivedAt ? <p role="status">{t('archived')}</p> : null}
        {data.deletedAt ? <p role="status">{t('deleted')}</p> : null}
      </header>

      {isGiftlist && data.permissions.edit ? <GiftSettings list={data} /> : null}

      {canAdd && adding ? (
        <AddItemPanel listId={id} right={data.permissions.add} isGiftlist={isGiftlist} />
      ) : null}

      <section aria-labelledby="items-title" className="flex flex-col gap-3">
        <h2 id="items-title" className="sr-only">
          {data.personal ? tl('personal') : data.title}
        </h2>
        {empty ? (
          <EmptyState
            title={t('noItems')}
            {...(addButton && !adding ? { action: addButton } : {})}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              {addButton}
              <div className="flex items-center gap-2">
                <Label htmlFor="sort">{t('sort.label')}</Label>
                <select
                  id="sort"
                  className="h-touch rounded-md border border-border-strong bg-surface px-3"
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value as ItemSort);
                  }}
                >
                  {SORTS.map((value) => (
                    <option key={value} value={value}>
                      {t(`sort.${value}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <ul className="flex flex-col gap-3">
              {items.data?.items.map((item) => (
                <li key={item.id}>
                  <ItemCard
                    item={item}
                    listId={id}
                    permissions={data.permissions}
                    isGiftlist={isGiftlist}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {data.permissions.manageMembers || data.myRole ? <Members list={data} /> : null}

      <ListActions list={data} />
    </div>
  );
}

const NO_PERMISSIONS = {
  edit: false,
  archive: false,
  delete: false,
  restore: false,
  manageMembers: false,
  add: AddRight.none,
  editRules: false,
  readLog: false,
} as const;

function ListActions({ list }: { list: ListGiverView | ListRecipientView }) {
  const t = useTranslations('list');
  const te = useTranslations('lists.errors');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateOneList({ request: { headers: { 'If-Match': `"${list.version}"` } } });
  const remove = useDeleteOneList();
  const leave = useLeaveList();
  const members = useListMembers(list.id);
  const onError = (e: unknown) => {
    setError(te(listErrorKey(e)));
  };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetOneListQueryKey(list.id) });
    void queryClient.invalidateQueries({ queryKey: getListListsQueryKey() });
  };
  const successor = members.data?.items.find((m) => m.role === 'OWNER' || m.role === 'CONTRIBUTOR');
  const canLeave = Boolean(list.myRole) && !list.personal && list.view === 'giver';
  // Rien à gérer : aucun bloc vide.
  if (!list.permissions.archive && !list.permissions.delete && !canLeave && !error) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <div className="flex flex-wrap gap-2">
        {list.permissions.archive ? (
          <Button
            variant="ghost"
            onClick={() => {
              update.mutate(
                { id: list.id, data: { archived: list.archivedAt === null } },
                { onSuccess: refresh, onError },
              );
            }}
          >
            {list.archivedAt === null ? t('archive') : t('unarchive')}
          </Button>
        ) : null}
        {list.permissions.delete ? (
          <ConfirmButton
            variant="ghost"
            className="text-danger"
            label={t('delete')}
            title={t('deleteTitle')}
            description={t('deleteBody')}
            confirmLabel={t('delete')}
            cancelLabel={t('cancel')}
            onConfirm={() => {
              remove.mutate(
                { id: list.id },
                {
                  onSuccess: () => {
                    refresh();
                    router.push('/lists');
                  },
                  onError,
                },
              );
            }}
          />
        ) : null}
        {list.myRole && !list.personal && list.view === 'giver' ? (
          <ConfirmButton
            variant="ghost"
            label={t('leave')}
            title={t('leaveTitle')}
            description={list.myRole === 'CREATOR' ? t('leaveSuccessor') : t('leaveBody')}
            confirmLabel={t('leave')}
            cancelLabel={t('cancel')}
            onConfirm={() => {
              leave.mutate(
                {
                  id: list.id,
                  data:
                    list.myRole === 'CREATOR' && successor
                      ? { successorProfileId: successor.profileId }
                      : {},
                },
                {
                  onSuccess: () => {
                    refresh();
                    router.push('/lists');
                  },
                  onError,
                },
              );
            }}
          />
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** GFT-03, GFT-04, GFT-05, GFT-08 : ce que voit le destinataire, réglé par les offreurs. */
function GiftSettings({ list }: { list: ListGiverView }) {
  const t = useTranslations('list.gift');
  const te = useTranslations('lists.errors');
  const queryClient = useQueryClient();
  const circle = useGetCircle();
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateOneList({ request: { headers: { 'If-Match': `"${list.version}"` } } });
  const sharedAccount = list.recipients.some((r) =>
    circle.data?.items.some((m) => m.profileId === r && m.source === 'ACCOUNT'),
  );

  function set(existence: GiftExistence, content: GiftContent) {
    // GFT-04 : l'interface règle la cohérence d'elle-même.
    const consistent = content === GiftContent.NONE ? existence : GiftExistence.REVEALED;
    setError(null);
    update.mutate(
      { id: list.id, data: { giftExistence: consistent, giftContent: content } },
      {
        onSuccess: () =>
          void queryClient.invalidateQueries({ queryKey: getGetOneListQueryKey(list.id) }),
        onError: (e) => {
          setError(te(listErrorKey(e)));
        },
      },
    );
  }

  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      <CardDescription className="mt-1">{t('never')}</CardDescription>
      {sharedAccount ? (
        <p role="note" className="mt-2 text-sm">
          {t('sharedAccount')}
        </p>
      ) : null}
      <fieldset className="mt-3 flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">{t('existence')}</legend>
        {[GiftExistence.HIDDEN, GiftExistence.REVEALED].map((value) => (
          <label key={value} className="flex min-h-touch items-center gap-2">
            <input
              type="radio"
              name="existence"
              checked={list.giftExistence === value}
              disabled={update.isPending}
              onChange={() => {
                set(value, value === GiftExistence.HIDDEN ? GiftContent.NONE : list.giftContent);
              }}
            />
            {t(value)}
          </label>
        ))}
      </fieldset>
      <fieldset className="mt-3 flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">{t('content')}</legend>
        {[GiftContent.NONE, GiftContent.PARTIAL, GiftContent.FULL].map((value) => (
          <label key={value} className="flex min-h-touch items-center gap-2">
            <input
              type="radio"
              name="content"
              checked={list.giftContent === value}
              disabled={update.isPending}
              onChange={() => {
                set(list.giftExistence, value);
              }}
            />
            {t(value)}
          </label>
        ))}
      </fieldset>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

/** LST-08 : membres pris dans son cercle ; jamais un destinataire de giftlist (GFT-01). */
function Members({ list }: { list: ListGiverView | ListRecipientView }) {
  const t = useTranslations('list.members');
  const tl = useTranslations('lists');
  const queryClient = useQueryClient();
  const members = useListMembers(list.id);
  const circle = useGetCircle();
  const setMember = useSetListMember();
  const removeMember = useRemoveListMember();
  const [candidate, setCandidate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const me = useGetOwnProfile();
  const names = new Map((circle.data?.items ?? []).map((m) => [m.profileId, m.displayName]));
  if (me.data) names.set(me.data.id, me.data.displayName);
  const current = new Set((members.data?.items ?? []).map((m) => m.profileId));
  const choices = (circle.data?.items ?? []).filter(
    (m) =>
      !current.has(m.profileId) &&
      !(
        list.view === 'giver' &&
        list.type === ListType.GIFTLIST &&
        list.recipients.includes(m.profileId)
      ),
  );
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(list.id) });
  const onError = (e: unknown) => {
    setError(tl(`errors.${listErrorKey(e)}`));
  };

  return (
    <section aria-labelledby="members-title" className="flex flex-col gap-3">
      <h2 id="members-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p className="text-sm text-foreground-muted">{t('who')}</p>
      {(members.data?.items.length ?? 0) <= 1 ? <p>{t('none')}</p> : null}
      <ul className="flex flex-col gap-2">
        {members.data?.items.map((member) => (
          <li
            key={member.profileId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-4"
          >
            <span>
              {names.get(member.profileId) ?? '…'} · {tl(`role.${member.role}`)}
            </span>
            {list.permissions.manageMembers && member.role !== 'CREATOR' ? (
              <Button
                variant="secondary"
                onClick={() => {
                  removeMember.mutate(
                    { id: list.id, profileId: member.profileId },
                    { onSuccess: refresh, onError },
                  );
                }}
              >
                {t('remove')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {list.permissions.manageMembers && choices.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-choice">{t('choose')}</Label>
            <select
              id="member-choice"
              className="h-touch rounded-md border border-border-strong bg-surface px-3"
              value={candidate}
              onChange={(e) => {
                setCandidate(e.target.value);
              }}
            >
              <option value="" />
              {choices.map((m) => (
                <option key={m.profileId} value={m.profileId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>
          <Button
            disabled={!candidate || setMember.isPending}
            onClick={() => {
              setMember.mutate(
                { id: list.id, profileId: candidate, data: { role: MemberRoleChoice.CONTRIBUTOR } },
                {
                  onSuccess: () => {
                    setCandidate('');
                    refresh();
                  },
                  onError,
                },
              );
            }}
          >
            {t('add')}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
