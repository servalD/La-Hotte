'use client';

import { ProfileImage } from '@/lib/offline/profile-image';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListItemsQueryKey,
  type ItemCollectionViewItemsItem,
  ItemPriority,
  type ListPermissionsView,
  useCopyItemProduct,
  useWithdrawItem,
  WithdrawnReason,
} from '@wishlist/api-client';
import { useLocale, useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Field } from '@/features/auth/field';
import { ItemAccountingButton } from '@/features/accounting/item-accounting';
import { ItemThreadsButton } from '@/features/conversations/item-threads';
import { text } from '@/features/auth/form-data';
import { Celebration, Confirmed, haptic, Highlight } from '@/lib/motion/moments';
import { offlineActions } from '@/lib/offline/actions';
import { kindKey, type QueuedInput } from '@/lib/offline/queue';
import { useOfflineAction, usePendingFor } from '@/lib/offline/queue-context';
import { listErrorKey } from './api-errors';
import { formatMinor } from './format';
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
  const [celebrate, setCelebrate] = useState(false);
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getListItemsQueryKey(listId) });
  const onError = (e: unknown) => {
    setMessage(te(listErrorKey(e)));
  };
  const perform = useOfflineAction();
  // UX-32, OFF-13 : un geste fait hors ligne s'affiche « à confirmer » jusqu'à la réponse.
  const pending = usePendingFor(item.id);
  const act = (input: QueuedInput) => {
    setMessage(null);
    perform(input)
      .then((outcome) => {
        if (!outcome.queued) refresh();
      })
      .catch(onError);
  };
  const withdraw = useWithdrawItem();
  const copy = useCopyItemProduct();

  const giver = item.view === 'giver' ? item : null;
  const recipient = item.view === 'recipient' ? item : null;
  const canEdit = item.mine || permissions.edit;
  const price =
    item.unitPriceMinor === null
      ? t('freePrice')
      : formatMinor(item.unitPriceMinor, item.currency, locale);

  return (
    // « Élément mis à jour par quelqu'un d'autre » : halo bref à chaque nouvelle version.
    <Highlight trigger={item.version} className="rounded-lg">
      <article className="relative flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        {/* « Réception confirmée » côté destinataire : confettis discrets (MOT-04 : aucun en mouvement réduit). */}
        <Celebration active={celebrate} />
        <div className="flex gap-4">
          {item.product.imageKey ? (
            <ProfileImage
              imageKey={item.product.imageKey}
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
                <Confirmed stateKey={giver.status}>
                  <span aria-hidden="true">{STATUS_ICON[giver.status]} </span>
                  {t(`status.${giver.status}`)}
                </Confirmed>
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
        {pending.length > 0 ? (
          <p className="text-sm text-foreground-muted">
            <span aria-hidden="true">⏳ </span>
            {pending.map((action) => t(`pending.${kindKey(action.kind)}`)).join(' · ')}
          </p>
        ) : null}

        {editing ? (
          <EditForm
            item={item}
            listId={listId}
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
            {/* CPT-02, CPT-59 : seulement sous la forme offreur. */}
            {giver ? <ItemAccountingButton itemId={item.id} title={item.product.title} /> : null}
            {recipient && !isGiftlist ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (!recipient.received) {
                      haptic();
                      setCelebrate(true);
                    }
                    act(offlineActions.received(item.id, listId, !recipient.received));
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
                  act(offlineActions.deleteItem(item.id, listId, item.product.title));
                }}
              />
            ) : null}
          </div>
        )}
      </article>
    </Highlight>
  );
}

function EditForm({
  item,
  listId,
  isGiftlist,
  onDone,
  onError,
}: {
  item: ItemCollectionViewItemsItem;
  listId: string;
  isGiftlist: boolean;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const t = useTranslations('item');
  const perform = useOfflineAction();
  const [saving, setSaving] = useState(false);
  const [priority, setPriority] = useState(item.priority);

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const quantity = Number(form.get('quantity'));
    setSaving(true);
    // OFF-14 : la version lue part avec la modification ; dépassée au rejeu, c'est un conflit.
    perform(
      offlineActions.updateItem(item.id, listId, item.version, {
        quantity: Number.isInteger(quantity) && quantity >= 1 ? quantity : item.quantity,
        priority,
        note: text(form, 'note'),
        manyWelcome: form.get('manyWelcome') === 'on',
        ...(isGiftlist && item.view === 'giver'
          ? { shownToRecipient: form.get('shown') === 'on' }
          : {}),
      }),
    )
      .then(onDone)
      .catch(onError)
      .finally(() => {
        setSaving(false);
      });
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
        <Button type="submit" disabled={saving}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
