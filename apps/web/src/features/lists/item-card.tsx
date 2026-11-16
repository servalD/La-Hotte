'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  getListItemsQueryKey,
  type ItemCollectionViewItemsItem,
  ItemPriority,
  type ListPermissionsView,
  useCopyItemProduct,
  useDeleteOneItem,
  useMarkItemReceived,
  useUnmarkItemReceived,
  useUpdateOneItem,
  useWithdrawItem,
  WithdrawnReason,
} from '@wishlist/api-client';
import { useLocale, useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Field } from '@/features/auth/field';
import { ItemThreadsButton } from '@/features/conversations/item-threads';
import { text } from '@/features/auth/form-data';
import { listErrorKey } from './api-errors';
import { formatMinor, imageUrl } from './format';
import { WhoSeesDialog } from './who-sees-dialog';

/** LST-12, LST-13 : couleur toujours doublée d'un pictogramme et d'un libellé (A11Y). */
const STATUS_ICON = { OPEN: '○', RESERVED: '◐', PURCHASED: '●', RECEIVED: '✓' } as const;

/**
 * Un élément, tel que l'API le rend : vue destinataire (neutre ou reçu, LST-16) ou vue offreur.
 * L'interface n'ajoute ni ne retire rien de ce qui est reçu.
 */
export function ItemCard({
  item,
  listId,
  permissions,
  isGiftlist,
}: {
  item: ItemCollectionViewItemsItem;
  listId: string;
  permissions: ListPermissionsView;
  isGiftlist: boolean;
}) {
  const t = useTranslations('item');
  const te = useTranslations('lists.errors');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getListItemsQueryKey(listId) });
  const onError = (e: unknown) => {
    setMessage(te(listErrorKey(e)));
  };
  const received = useMarkItemReceived();
  const unreceived = useUnmarkItemReceived();
  const withdraw = useWithdrawItem();
  const remove = useDeleteOneItem();
  const copy = useCopyItemProduct();

  const giver = item.view === 'giver' ? item : null;
  const recipient = item.view === 'recipient' ? item : null;
  const canEdit = item.mine || permissions.edit;
  const price =
    item.unitPriceMinor === null
      ? t('freePrice')
      : formatMinor(item.unitPriceMinor, item.currency, locale);

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex gap-4">
        {item.product.imageKey ? (
          // EXT-47 : image servie par notre API ; pas d'optimisation de Next pour une image privée.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl(item.product.imageKey)}
            alt=""
            width={96}
            height={96}
            className="size-24 shrink-0 rounded-md object-cover"
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="font-semibold break-words">{item.product.title}</h3>
          <p className="text-sm">
            {price}
            {item.quantity > 1 ? ` · ${t('quantity', { count: item.quantity })}` : ''}
            {item.quantity > 1 && item.unitPriceMinor !== null
              ? ` · ${t('total', { amount: formatMinor(item.unitPriceMinor * item.quantity, item.currency, locale) })}`
              : ''}
          </p>
          <p className="text-sm text-foreground-muted">
            {t(`priority.${item.priority}`)}
            {item.manyWelcome ? ` · ${t('manyWelcome')}` : ''}
            {item.hidden ? ` · ${t('hidden')}` : ''}
          </p>
          {item.note ? <p className="text-sm break-words">{item.note}</p> : null}
          {recipient?.received ? (
            <p className="text-sm font-medium text-success">
              <span aria-hidden="true">✓ </span>
              {t('received')}
            </p>
          ) : null}
          {giver ? (
            <p className="text-sm font-medium">
              <span aria-hidden="true">{STATUS_ICON[giver.status]} </span>
              {t(`status.${giver.status}`)}
              {giver.isSuggestion ? ` · ${t('suggestion')}` : ''}
            </p>
          ) : null}
          {item.product.sourceUrl ? (
            <a
              href={item.product.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm underline"
            >
              {t('openSource')}
            </a>
          ) : null}
        </div>
      </div>

      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}

      {editing ? (
        <EditForm
          item={item}
          isGiftlist={isGiftlist}
          onDone={() => {
            setEditing(false);
            refresh();
          }}
          onError={onError}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <ItemThreadsButton itemId={item.id} title={item.product.title} />
          {recipient && !isGiftlist ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  (recipient.received ? unreceived : received).mutate(
                    { id: item.id },
                    { onSuccess: refresh, onError },
                  );
                }}
              >
                {recipient.received ? t('unmarkReceived') : t('markReceived')}
              </Button>
              <ConfirmButton
                variant="secondary"
                label={t('withdraw.action')}
                title={t('withdraw.title')}
                description={t('withdraw.body')}
                confirmLabel={t('withdraw.noLonger')}
                cancelLabel={t('cancel')}
                onConfirm={() => {
                  withdraw.mutate(
                    { id: item.id, data: { reason: WithdrawnReason.NO_LONGER_WANTED } },
                    { onSuccess: refresh, onError },
                  );
                }}
              />
            </>
          ) : null}
          {canEdit ? (
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(true);
              }}
            >
              {t('edit')}
            </Button>
          ) : null}
          {permissions.editRules || item.mine ? (
            <WhoSeesDialog itemId={item.id} listId={listId} />
          ) : null}
          {!item.mine ? (
            <Button
              variant="ghost"
              disabled={copy.isPending}
              onClick={() => {
                copy.mutate(
                  { id: item.id },
                  {
                    onSuccess: () => {
                      setMessage(t('copied'));
                    },
                    onError,
                  },
                );
              }}
            >
              {t('copy')}
            </Button>
          ) : null}
          {canEdit ? (
            <ConfirmButton
              variant="secondary"
              label={t('delete')}
              title={t('deleteTitle')}
              description={t('deleteBody')}
              confirmLabel={t('delete')}
              cancelLabel={t('cancel')}
              onConfirm={() => {
                remove.mutate({ id: item.id }, { onSuccess: refresh, onError });
              }}
            />
          ) : null}
        </div>
      )}
    </article>
  );
}

function EditForm({
  item,
  isGiftlist,
  onDone,
  onError,
}: {
  item: ItemCollectionViewItemsItem;
  isGiftlist: boolean;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const t = useTranslations('item');
  const update = useUpdateOneItem({ request: { headers: { 'If-Match': `"${item.version}"` } } });
  const [priority, setPriority] = useState(item.priority);

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const quantity = Number(form.get('quantity'));
    update.mutate(
      {
        id: item.id,
        data: {
          quantity: Number.isInteger(quantity) && quantity >= 1 ? quantity : item.quantity,
          priority,
          note: text(form, 'note'),
          manyWelcome: form.get('manyWelcome') === 'on',
          ...(isGiftlist && item.view === 'giver'
            ? { shownToRecipient: form.get('shown') === 'on' }
            : {}),
        },
      },
      { onSuccess: onDone, onError },
    );
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      <Field
        label={t('fields.quantity')}
        name="quantity"
        type="number"
        min={1}
        max={999}
        defaultValue={item.quantity}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`priority-${item.id}`}>{t('fields.priority')}</Label>
        <select
          id={`priority-${item.id}`}
          className="h-touch rounded-md border border-border-strong bg-surface px-3"
          value={priority}
          onChange={(e) => {
            setPriority(e.target.value as ItemPriority);
          }}
        >
          {[ItemPriority.WANT, ItemPriority.LOVE, ItemPriority.MUST].map((p) => (
            <option key={p} value={p}>
              {t(`priority.${p}`)}
            </option>
          ))}
        </select>
      </div>
      <Field label={t('fields.note')} name="note" maxLength={500} defaultValue={item.note} />
      <label className="flex min-h-touch items-center gap-2">
        <input type="checkbox" name="manyWelcome" defaultChecked={item.manyWelcome} />
        {t('fields.manyWelcome')}
      </label>
      {isGiftlist && item.view === 'giver' ? (
        <label className="flex min-h-touch items-center gap-2">
          <input type="checkbox" name="shown" defaultChecked={item.shownToRecipient} />
          {t('fields.shown')}
        </label>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
