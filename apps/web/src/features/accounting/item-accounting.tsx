'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  type GetItemAccounting200,
  type ItemAccountingParticipantView,
  useApproveAccountingReview,
  useDeleteItemContribution,
  useDeleteItemPurchase,
  useGetItemAccounting,
  useLowerItemContribution,
  usePostItemShortfallNotice,
  usePutItemContribution,
  usePutItemPurchase,
  useRefuseAccountingReview,
} from '@wishlist/api-client';
import { useLocale, useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatMinor } from '@/features/lists/format';
import { AccountingOptions, BuyerRequestSection, ReceiptSection } from './accounting-extras';
import { parseAmount } from './parse-amount';
import { useIdempotencyKey } from './use-idempotency-key';

/** Codes d'erreur traduits (API-14) ; les autres tombent sur un message général. */
const KNOWN_ERRORS = [
  'CONTRIBUTION_EXCEEDS_REMAINING',
  'CONTRIBUTION_FROZEN',
  'CONTRIBUTION_SETTLED',
  'CONTRIBUTION_INVALID',
  'ACCOUNTING_CLOSED',
  'ACCOUNTING_ACTION_FORBIDDEN',
  'PURCHASE_UNCHECK_CONFIRM',
] as const;

function errorKey(error: unknown): string {
  if (
    error instanceof ApiError &&
    (KNOWN_ERRORS as readonly string[]).includes(error.problem.code)
  ) {
    return `errors.${error.problem.code}`;
  }
  return 'errors.generic';
}

export { parseAmount };

/**
 * Bouton « Offrir » d'un élément vu en offreur (CPT-02). N'est monté que pour la forme offreur ;
 * l'API rend de toute façon `404` à un destinataire (CPT-59, VIS-20).
 */
export function ItemAccountingButton({ itemId, title }: { itemId: string; title: string }) {
  const t = useTranslations('accounting');
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">{t('open')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('title', { item: title })}</DialogTitle>
        {open ? <ItemAccounting itemId={itemId} /> : null}
      </DialogContent>
    </Dialog>
  );
}

export function ItemAccounting({ itemId }: { itemId: string }) {
  const t = useTranslations('accounting');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { data } = useGetItemAccounting(itemId);
  const [error, setError] = useState<string | null>(null);
  const [shortfallFor, setShortfallFor] = useState<number | null>(null);
  if (!data) return <p className="text-foreground-muted">{t('loading')}</p>;
  const view: GetItemAccounting200 = data;
  const money = (minor: number) => formatMinor(minor, view.currency, locale);
  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({
      predicate: (q) => JSON.stringify(q.queryKey).includes(itemId),
    });
  };
  const onError = (e: unknown) => {
    setError(t(errorKey(e)));
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-foreground-muted">{t('whoSees')}</p>
      <dl className="grid grid-cols-2 gap-1 text-sm">
        <dt>{t('planned')}</dt>
        <dd>{view.plannedTotalMinor === null ? t('noPrice') : money(view.plannedTotalMinor)}</dd>
        {view.itemTotalMinor !== null ? (
          <>
            <dt>{t('itemPrice')}</dt>
            <dd>{money(view.itemTotalMinor)}</dd>
          </>
        ) : null}
        <dt>{t('covered')}</dt>
        <dd>{money(view.coveredMinor)}</dd>
        {view.remainingMinor !== null ? (
          <>
            <dt>{t('remaining')}</dt>
            <dd>{money(view.remainingMinor)}</dd>
          </>
        ) : null}
        <dt>{t('buyer')}</dt>
        <dd>{view.buyer?.displayName ?? t('noBuyer')}</dd>
        <dt>{t('state')}</dt>
        {/* Couleur jamais seule : un libellé dit l'état (WCAG). */}
        <dd>{view.purchased ? t('purchased') : t('notPurchased')}</dd>
      </dl>
      <ul aria-label={t('participants')} className="flex flex-col gap-1 text-sm">
        {view.view === 'participant'
          ? view.participants.map((line) => (
              <li key={line.rank}>
                {line.person?.displayName ?? t('someone')} · {t(`mode.${line.mode}`)}
                {line.amountMinor !== null ? ` · ${money(line.amountMinor)}` : ''}
                {line.isBuyer ? ` · ${t('isBuyer')}` : ''}
              </li>
            ))
          : view.participants.map((line) => (
              <li key={line.rank}>
                {line.person?.displayName ?? t('someone')} · {t(`mode.${line.mode}`)}
                {line.isBuyer ? ` · ${t('isBuyer')}` : ''}
              </li>
            ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {view.canContribute && !view.purchased ? (
        <ContributeForm itemId={itemId} view={view} onDone={refresh} onError={onError} />
      ) : null}
      {view.view === 'participant' ? (
        <ParticipantActions
          itemId={itemId}
          view={view}
          onDone={refresh}
          onError={onError}
          onShortfall={setShortfallFor}
        />
      ) : null}
      {view.view === 'participant' ? (
        <>
          <BuyerRequestSection itemId={itemId} view={view} onDone={refresh} onError={onError} />
          <ReceiptSection itemId={itemId} view={view} onDone={refresh} onError={onError} />
          <AccountingOptions
            key={`${String(view.reviewEnabled)}-${String(view.receiptEnabled)}`}
            itemId={itemId}
            view={view}
            onDone={refresh}
            onError={onError}
          />
        </>
      ) : null}
      {view.view === 'participant' && shortfallFor !== null ? (
        <ShortfallWindow
          itemId={itemId}
          view={view}
          amount={money(shortfallFor)}
          onClose={() => {
            setShortfallFor(null);
            refresh();
          }}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

function ContributeForm({
  itemId,
  view,
  onDone,
  onError,
}: {
  itemId: string;
  view: GetItemAccounting200;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const t = useTranslations('accounting');
  const locale = useLocale();
  const { request, renew } = useIdempotencyKey();
  const [mode, setMode] = useState<'PERCENT' | 'FIXED'>('FIXED');
  const [value, setValue] = useState('');
  const contribute = usePutItemContribution({
    request,
    mutation: {
      onSuccess: () => {
        renew();
        setValue('');
        onDone();
      },
      onError,
    },
  });
  const entamé = view.coveredMinor > 0;
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (mode === 'FIXED') {
      const amountMinor = parseAmount(value);
      if (amountMinor === null || amountMinor === 0) {
        onError(null);
        return;
      }
      contribute.mutate({ id: itemId, data: { mode: 'FIXED', amountMinor } });
      return;
    }
    // CPT-53 : un pour cent au centième, en fraction exacte sur 10 000.
    const hundredths = parseAmount(value);
    if (hundredths === null || hundredths === 0 || hundredths > 10_000) {
      onError(null);
      return;
    }
    contribute.mutate({
      id: itemId,
      data: { mode: 'PERCENT', shareNum: hundredths, shareDen: 10_000 },
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <Button
        disabled={contribute.isPending}
        onClick={() => {
          contribute.mutate({ id: itemId, data: { mode: 'FULL' } });
        }}
      >
        {entamé && view.remainingMinor !== null
          ? t('complete', { amount: formatMinor(view.remainingMinor, view.currency, locale) })
          : t('giveAll')}
      </Button>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="contribution-mode">{t('participate')}</Label>
          <select
            id="contribution-mode"
            className="min-h-touch rounded-md border border-border bg-surface px-2"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value === 'PERCENT' ? 'PERCENT' : 'FIXED');
            }}
          >
            <option value="FIXED">{t('mode.FIXED')}</option>
            {view.plannedTotalMinor !== null ? (
              <option value="PERCENT">{t('mode.PERCENT')}</option>
            ) : null}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="contribution-value">
            {mode === 'FIXED' ? t('amount') : t('percent')}
          </Label>
          <Input
            id="contribution-value"
            inputMode="decimal"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
            }}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={contribute.isPending}>
          {t('confirm')}
        </Button>
      </form>
    </div>
  );
}

function ParticipantActions({
  itemId,
  view,
  onDone,
  onError,
  onShortfall,
}: {
  itemId: string;
  view: ItemAccountingParticipantView;
  onDone: () => void;
  onError: (e: unknown) => void;
  onShortfall: (amount: number) => void;
}) {
  const t = useTranslations('accounting');
  const withdrawKey = useIdempotencyKey();
  const purchaseKey = useIdempotencyKey();
  const uncheckKey = useIdempotencyKey();
  const lowerKey = useIdempotencyKey();
  const reviewKey = useIdempotencyKey();
  const [paid, setPaid] = useState('');
  const [lowered, setLowered] = useState('');
  const options = (k: ReturnType<typeof useIdempotencyKey>) => ({
    request: k.request,
    mutation: {
      onSuccess: () => {
        k.renew();
        onDone();
      },
      onError,
    },
  });
  const withdraw = useDeleteItemContribution(options(withdrawKey));
  const purchase = usePutItemPurchase(options(purchaseKey));
  const uncheck = useDeleteItemPurchase(options(uncheckKey));
  const approve = useApproveAccountingReview(options(reviewKey));
  const refuse = useRefuseAccountingReview(options(reviewKey));
  const lower = useLowerItemContribution({
    request: lowerKey.request,
    mutation: {
      onSuccess: (result) => {
        lowerKey.renew();
        // CPT-19 : un reste laissé ouvre la fenêtre pour son auteur.
        if (result.remainingMinor) onShortfall(result.remainingMinor);
        onDone();
      },
      onError,
    },
  });
  const mine = view.mine;
  return (
    <div className="flex flex-col gap-3">
      {mine ? (
        <p className="text-sm">
          {t('myPart')} · {t(`settlement.${mine.settlement}`)}
        </p>
      ) : null}
      {!view.purchased && mine ? (
        <Button
          variant="ghost"
          disabled={withdraw.isPending}
          onClick={() => {
            withdraw.mutate({ id: itemId });
          }}
        >
          {t('withdraw')}
        </Button>
      ) : null}
      {view.isBuyer && !view.purchased ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="paid">{t('paid')}</Label>
            <Input
              id="paid"
              inputMode="decimal"
              value={paid}
              onChange={(e) => {
                setPaid(e.target.value);
              }}
            />
          </div>
          <Button
            disabled={purchase.isPending}
            onClick={() => {
              const actualTotalMinor = paid.trim() === '' ? null : parseAmount(paid);
              purchase.mutate({ id: itemId, data: { actualTotalMinor } });
            }}
          >
            {t('markPurchased')}
          </Button>
        </div>
      ) : null}
      {view.isBuyer && view.purchased ? (
        <Button
          variant="ghost"
          disabled={uncheck.isPending}
          onClick={() => {
            uncheck.mutate({ id: itemId, params: {} });
          }}
        >
          {t('uncheck')}
        </Button>
      ) : null}
      {view.purchased && mine && !view.isBuyer ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="lowered">{t('lower')}</Label>
            <Input
              id="lowered"
              inputMode="decimal"
              value={lowered}
              onChange={(e) => {
                setLowered(e.target.value);
              }}
            />
          </div>
          <Button
            variant="secondary"
            disabled={lower.isPending}
            onClick={() => {
              const amountMinor = parseAmount(lowered);
              if (amountMinor !== null) lower.mutate({ id: itemId, data: { amountMinor } });
            }}
          >
            {t('confirm')}
          </Button>
        </div>
      ) : null}
      {view.reviews.length > 0 ? (
        <section aria-label={t('reviews')} className="flex flex-col gap-2">
          {view.reviews.map((review) => (
            <div key={review.id} className="rounded-md border border-border p-2 text-sm">
              <p>{review.kind === 'COST' ? t('reviewCost') : t('reviewOptions')}</p>
              {review.canDecide ? (
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      approve.mutate({ id: review.id });
                    }}
                  >
                    {t('approve')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      refuse.mutate({ id: review.id });
                    }}
                  >
                    {t('refuse')}
                  </Button>
                </div>
              ) : (
                <p className="text-foreground-muted">{t('reviewWaiting')}</p>
              )}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

/**
 * CPT-19 : « Il reste … à couvrir. Prévenir les autres participants ? » Tous cochés par défaut ;
 * le choix n'est lu que par son auteur.
 */
export function ShortfallWindow({
  itemId,
  view,
  amount,
  onClose,
  onError,
}: {
  itemId: string;
  view: ItemAccountingParticipantView;
  amount: string;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const t = useTranslations('accounting');
  const others = view.participants.filter((line) => !line.mine && line.person);
  const [chosen, setChosen] = useState(() => new Set(others.map((line) => line.person?.id ?? '')));
  const { request } = useIdempotencyKey();
  const notify = usePostItemShortfallNotice({ request, mutation: { onSuccess: onClose, onError } });
  return (
    <section
      aria-label={t('shortfallTitle')}
      className="flex flex-col gap-2 rounded-md border border-border p-3"
    >
      <p>{t('shortfall', { amount })}</p>
      <p className="text-sm text-foreground-muted">{t('shortfallPrivate')}</p>
      {others.map((line) => {
        const id = line.person?.id ?? '';
        return (
          <label key={id} className="flex min-h-touch items-center gap-2">
            <input
              type="checkbox"
              checked={chosen.has(id)}
              onChange={(e) => {
                const next = new Set(chosen);
                if (e.target.checked) next.add(id);
                else next.delete(id);
                setChosen(next);
              }}
            />
            {line.person?.displayName}
          </label>
        );
      })}
      <div className="flex gap-2">
        <Button
          onClick={() => {
            notify.mutate({ id: itemId, data: { profileIds: [...chosen] } });
          }}
        >
          {t('notify')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            notify.mutate({ id: itemId, data: { profileIds: [] } });
          }}
        >
          {t('notifyNobody')}
        </Button>
      </div>
    </section>
  );
}
