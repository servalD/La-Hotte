'use client';

import { type ItemPriority, useGetOneItem } from '@wishlist/api-client';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatMinor } from '@/features/lists/format';
import { offlineActions } from '@/lib/offline/actions';
import { kindKey, type QueuedAction } from '@/lib/offline/queue';
import { useActionQueue, useQueuedActions } from '@/lib/offline/queue-context';

/** Raisons traduites d'un refus (API-14) ; les autres tombent sur la raison par statut. */
const KNOWN_CODES = [
  'CONTRIBUTION_EXCEEDS_REMAINING',
  'ACCOUNTING_CLOSED',
  'CONTRIBUTION_FROZEN',
  'CONTRIBUTION_SETTLED',
  'PURCHASE_REQUIRED',
  'ITEM_NOT_FOUND',
  'LIST_NOT_FOUND',
  'IDEMPOTENCY_KEY_REUSED',
] as const;

function reasonKey(action: QueuedAction): string {
  if (action.state === 'expired') return 'reasons.expired';
  if (action.state === 'conflict') return 'reasons.conflict';
  const code = action.outcome?.code ?? '';
  if ((KNOWN_CODES as readonly string[]).includes(code)) return `reasons.${code}`;
  const status = action.outcome?.status ?? 0;
  if (status === 404) return 'reasons.gone';
  if (status === 403) return 'reasons.forbidden';
  return 'reasons.refused';
}

/**
 * OFF-15 : aucune action refusée n'est perdue sans explication. Actions en attente d'envoi, et
 * actions refusées, en conflit ou trop anciennes, avec la raison et, quand c'est possible, un
 * bouton pour les refaire.
 */
export function ActionsScreen() {
  const t = useTranslations('offlineActions');
  const actions = useQueuedActions();
  const waiting = actions.filter((a) => a.state === 'pending');
  const stuck = actions.filter((a) => a.state !== 'pending');
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <p className="text-sm text-foreground-muted">{t('intro')}</p>
      {actions.length === 0 ? <p>{t('empty')}</p> : null}
      {stuck.length > 0 ? (
        <section aria-labelledby="stuck" className="flex flex-col gap-3">
          <h2 id="stuck" className="font-medium">
            {t('stuck')}
          </h2>
          <ul className="flex flex-col gap-3">
            {stuck.map((action) => (
              <li key={action.id}>
                <StuckAction action={action} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {waiting.length > 0 ? (
        <section aria-labelledby="waiting" className="flex flex-col gap-3">
          <h2 id="waiting" className="font-medium">
            {t('waiting')}
          </h2>
          <ul className="flex flex-col gap-2">
            {waiting.map((action) => (
              <li key={action.id} className="rounded-md border border-dashed border-border p-3">
                <ActionLabel action={action} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ActionLabel({ action }: { action: QueuedAction }) {
  const t = useTranslations('offlineActions');
  const detail = action.display.title ?? action.display.body ?? action.display.url ?? null;
  return (
    <p className="break-words">
      {t(`kinds.${kindKey(action.kind)}`)}
      {typeof detail === 'string' && detail ? ` · ${detail}` : ''}
    </p>
  );
}

function StuckAction({ action }: { action: QueuedAction }) {
  const t = useTranslations('offlineActions');
  const locale = useLocale();
  const queue = useActionQueue();
  const remaining = action.outcome?.remainingMinor;
  const itemId = action.subject.itemId;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3" role="group">
      <ActionLabel action={action} />
      <p className="text-sm">{t(reasonKey(action))}</p>
      {action.state === 'conflict' && action.kind === 'item.update' && itemId ? (
        <ConflictResolver action={action} itemId={itemId} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {/* OFF-13 : quelqu'un a complété entre-temps ; on propose le reste disponible. */}
          {action.kind === 'contribution.put' && itemId && remaining && remaining > 0 ? (
            <Button
              onClick={() => {
                void queue?.redo(
                  action.id,
                  offlineActions.contribute(
                    itemId,
                    { mode: 'FIXED', amountMinor: remaining },
                    remaining,
                  ),
                );
              }}
            >
              {t('useRemaining', { amount: formatMinor(remaining, 'EUR', locale) })}
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                void queue?.redo(action.id);
              }}
            >
              {t('redo')}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              void queue?.discard(action.id);
            }}
          >
            {t('discard')}
          </Button>
        </div>
      )}
    </div>
  );
}

const FIELDS = ['quantity', 'priority', 'note', 'manyWelcome', 'shownToRecipient'] as const;
type Field = (typeof FIELDS)[number];

/**
 * OFF-14 : deux versions d'un élément, champ par champ ; on choisit pour chaque champ modifié,
 * et la modification repart sur la version actuelle. Pas d'écrasement silencieux.
 */
function ConflictResolver({ action, itemId }: { action: QueuedAction; itemId: string }) {
  const t = useTranslations('offlineActions');
  const ti = useTranslations('item');
  const queue = useActionQueue();
  const { data: current } = useGetOneItem(itemId);
  const mine = action.display;
  const changed = FIELDS.filter((f) => f in mine);
  const [choice, setChoice] = useState<Record<string, 'mine' | 'current'>>({});
  if (!current) return <p className="text-sm text-foreground-muted">{t('loadingCurrent')}</p>;
  const currentValue = (field: Field): unknown =>
    (current as unknown as Record<string, unknown>)[field];
  const show = (field: Field, value: unknown): string => {
    if (typeof value === 'boolean') return value ? t('yes') : t('no');
    if (field === 'priority' && typeof value === 'string') return ti(`priority.${value}`);
    return typeof value === 'string' || typeof value === 'number'
      ? String(value) || t('none')
      : t('none');
  };
  const differing = changed.filter((f) => currentValue(f) !== mine[f]);
  const apply = () => {
    const changes: Record<string, unknown> = {};
    for (const field of differing) {
      if (choice[field] === 'mine') changes[field] = mine[field];
    }
    if (Object.keys(changes).length === 0) {
      void queue?.discard(action.id);
      return;
    }
    void queue?.redo(
      action.id,
      offlineActions.updateItem(itemId, action.subject.listId ?? '', current.version, {
        ...(changes as { quantity?: number; priority?: ItemPriority; note?: string }),
      }),
    );
  };
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium">{t('chooseFields')}</legend>
      {differing.length === 0 ? <p className="text-sm">{t('sameNow')}</p> : null}
      {differing.map((field) => (
        <div
          key={field}
          className="flex flex-col gap-1 text-sm"
          role="radiogroup"
          aria-label={ti(`fields.${field === 'shownToRecipient' ? 'shown' : field}`)}
        >
          <p className="font-medium">
            {ti(`fields.${field === 'shownToRecipient' ? 'shown' : field}`)}
          </p>
          <label className="flex min-h-touch items-center gap-2">
            <input
              type="radio"
              name={`${action.id}-${field}`}
              checked={choice[field] === 'mine'}
              onChange={() => {
                setChoice({ ...choice, [field]: 'mine' });
              }}
            />
            {t('mine')} : {show(field, mine[field])}
          </label>
          <label className="flex min-h-touch items-center gap-2">
            <input
              type="radio"
              name={`${action.id}-${field}`}
              checked={choice[field] !== 'mine'}
              onChange={() => {
                setChoice({ ...choice, [field]: 'current' });
              }}
            />
            {t('current')} : {show(field, currentValue(field))}
          </label>
        </div>
      ))}
      <div className="flex gap-2">
        <Button onClick={apply}>{t('applyChoice')}</Button>
        <Button
          variant="ghost"
          onClick={() => {
            void queue?.discard(action.id);
          }}
        >
          {t('discard')}
        </Button>
      </div>
    </fieldset>
  );
}
