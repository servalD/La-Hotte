'use client';

import {
  type BalanceLineView,
  getGetItemPurchaseReceiptUrl,
  type ItemAccountingParticipantView,
  type OverviewGroupView,
  useAcceptBuyerRequest,
  useCancelBuyerRequest,
  useClaimContributionSettlement,
  useConfirmOffset,
  useDeclineOffset,
  useDeleteBudget,
  useListBudgets,
  useListOffsetProposals,
  useNudgeContribution,
  usePostItemBuyerRequest,
  usePutBudget,
  usePutContributionSettlement,
  usePutItemAccountingOptions,
  usePutItemPurchaseReceipt,
  useRefuseBuyerRequest,
} from '@wishlist/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { type ChangeEvent, type SyntheticEvent, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatMinor } from '@/features/lists/format';
import { parseAmount } from './parse-amount';
import { useIdempotencyKey } from './use-idempotency-key';

type Handlers = { onDone: () => void; onError: (e: unknown) => void };

/** Options d'une mutation de compta : clé renouvelée après un succès (CPT-71). */
function withKey(key: ReturnType<typeof useIdempotencyKey>, handlers: Handlers) {
  return {
    request: key.request,
    mutation: {
      onSuccess: () => {
        key.renew();
        handlers.onDone();
      },
      onError: handlers.onError,
    },
  };
}

/** Relit toutes les vues de compta après un geste (panier, comptes, vue latérale, élément). */
function useAccountingRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({
      predicate: (q) =>
        /cart|balances|offset-proposals|budgets|accounting/.test(JSON.stringify(q.queryKey)),
    });
  };
}

/**
 * CPT-58 : options de compta de l'élément (revue, justificatif), lues et réglées par les seuls
 * participants. Avec la revue cochée et plus d'un participant, le changement attend un autre
 * participant.
 */
export function AccountingOptions({
  itemId,
  view,
  ...handlers
}: { itemId: string; view: ItemAccountingParticipantView } & Handlers) {
  const t = useTranslations('accounting');
  const key = useIdempotencyKey();
  const [review, setReview] = useState(view.reviewEnabled);
  const [receipt, setReceipt] = useState(view.receiptEnabled);
  const save = usePutItemAccountingOptions(withKey(key, handlers));
  const changed = review !== view.reviewEnabled || receipt !== view.receiptEnabled;
  const reviewId = useId();
  const receiptId = useId();
  return (
    <details className="rounded-md border border-border p-2 text-sm">
      <summary className="min-h-touch cursor-pointer content-center">
        {t('options.title')} ·{' '}
        {t('options.summary', {
          review: view.reviewEnabled ? 'on' : 'off',
          receipt: view.receiptEnabled ? 'on' : 'off',
        })}
      </summary>
      <div className="flex flex-col gap-2 pt-2">
        <p className="text-foreground-muted">{t('options.whoSees')}</p>
        <label htmlFor={reviewId} className="flex min-h-touch items-center gap-2">
          <input
            id={reviewId}
            type="checkbox"
            checked={review}
            onChange={(e) => {
              setReview(e.target.checked);
            }}
          />
          {t('options.review')}
        </label>
        <label htmlFor={receiptId} className="flex min-h-touch items-center gap-2">
          <input
            id={receiptId}
            type="checkbox"
            checked={receipt}
            onChange={(e) => {
              setReceipt(e.target.checked);
            }}
          />
          {t('options.receipt')}
        </label>
        {view.reviewEnabled && view.participants.length > 1 ? (
          <p className="text-foreground-muted">{t('options.needsReview')}</p>
        ) : null}
        <Button
          variant="secondary"
          disabled={!changed || save.isPending}
          onClick={() => {
            save.mutate({ id: itemId, data: { reviewEnabled: review, receiptEnabled: receipt } });
          }}
        >
          {t('options.save')}
        </Button>
      </div>
    </details>
  );
}

/** CPT-61 : se proposer comme acheteur, retirer sa demande, ou décider. */
export function BuyerRequestSection({
  itemId,
  view,
  ...handlers
}: { itemId: string; view: ItemAccountingParticipantView } & Handlers) {
  const t = useTranslations('accounting');
  const askKey = useIdempotencyKey();
  const decideKey = useIdempotencyKey();
  const ask = usePostItemBuyerRequest(withKey(askKey, handlers));
  const accept = useAcceptBuyerRequest(withKey(decideKey, handlers));
  const refuse = useRefuseBuyerRequest(withKey(decideKey, handlers));
  const cancel = useCancelBuyerRequest(withKey(decideKey, handlers));
  const request = view.buyerRequest;
  if (view.purchased) return null;
  if (!request) {
    if (!view.mine || view.isBuyer) return null;
    return (
      <Button
        variant="ghost"
        disabled={ask.isPending}
        onClick={() => {
          ask.mutate({ id: itemId });
        }}
      >
        {t('buyerRequest.ask')}
      </Button>
    );
  }
  return (
    <section
      aria-label={t('buyerRequest.title')}
      className="flex flex-col gap-2 rounded-md border border-border p-2 text-sm"
    >
      <p>
        {request.mine
          ? t('buyerRequest.mine')
          : t('buyerRequest.other', { name: request.candidate?.displayName ?? t('someone') })}
      </p>
      {request.mine ? (
        <Button
          variant="ghost"
          disabled={cancel.isPending}
          onClick={() => {
            cancel.mutate({ id: request.id });
          }}
        >
          {t('buyerRequest.cancel')}
        </Button>
      ) : request.canDecide ? (
        <div className="flex gap-2">
          <Button
            disabled={accept.isPending}
            onClick={() => {
              accept.mutate({ id: request.id });
            }}
          >
            {t('approve')}
          </Button>
          <Button
            variant="ghost"
            disabled={refuse.isPending}
            onClick={() => {
              refuse.mutate({ id: request.id });
            }}
          >
            {t('refuse')}
          </Button>
        </div>
      ) : (
        <p className="text-foreground-muted">{t('buyerRequest.waiting')}</p>
      )}
    </section>
  );
}

/** CPT-15, CPT-62 : justificatif joint par l'acheteur, lu par les seuls participants. */
export function ReceiptSection({
  itemId,
  view,
  ...handlers
}: { itemId: string; view: ItemAccountingParticipantView } & Handlers) {
  const t = useTranslations('accounting');
  const key = useIdempotencyKey();
  const upload = usePutItemPurchaseReceipt(withKey(key, handlers));
  const inputId = useId();
  if (!view.purchased || !view.receiptEnabled) return null;
  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const photo = event.target.files?.[0];
    if (photo) upload.mutate({ id: itemId, data: { photo } });
    event.target.value = '';
  };
  return (
    <section aria-label={t('receipt.title')} className="flex flex-col gap-2 text-sm">
      {view.hasReceipt ? (
        <a
          href={getGetItemPurchaseReceiptUrl(itemId)}
          target="_blank"
          rel="noopener noreferrer"
          className="min-h-touch content-center underline"
        >
          {t('receipt.view')}
        </a>
      ) : (
        <p className="text-foreground-muted">{t('receipt.none')}</p>
      )}
      {view.isBuyer ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor={inputId}>
            {view.hasReceipt ? t('receipt.replace') : t('receipt.add')}
          </Label>
          <input
            id={inputId}
            type="file"
            accept="image/*"
            disabled={upload.isPending}
            onChange={onFile}
          />
          <p className="text-foreground-muted">{t('receipt.privacy')}</p>
        </div>
      ) : null}
    </section>
  );
}

/**
 * CPT-20 à CPT-23, CPT-65 : sur une ligne de compte, l'acheteur règle ou annule et relance ;
 * le participant signale qu'il a payé.
 */
export function SettlementActions({ line, viewerId }: { line: BalanceLineView; viewerId: string }) {
  const t = useTranslations('accounting');
  const refresh = useAccountingRefresh();
  const [error, setError] = useState<string | null>(null);
  const handlers: Handlers = {
    onDone: () => {
      setError(null);
      refresh();
    },
    onError: () => {
      setError(t('errors.generic'));
    },
  };
  const settleKey = useIdempotencyKey();
  const claimKey = useIdempotencyKey();
  const nudgeKey = useIdempotencyKey();
  const settle = usePutContributionSettlement(withKey(settleKey, handlers));
  const claim = useClaimContributionSettlement(withKey(claimKey, handlers));
  const nudge = useNudgeContribution(withKey(nudgeKey, handlers));
  const iAmBuyer = line.buyerId === viewerId;
  const done = line.settlement === 'SETTLED';
  return (
    <div className="flex flex-wrap items-center gap-2">
      {iAmBuyer ? (
        <>
          <Button
            variant={done ? 'ghost' : 'secondary'}
            disabled={settle.isPending}
            onClick={() => {
              settle.mutate({ id: line.contributionId, data: { settled: !done } });
            }}
          >
            {done ? t('settle.undo') : t('settle.mark')}
          </Button>
          {!done ? (
            <Button
              variant="ghost"
              disabled={nudge.isPending}
              onClick={() => {
                nudge.mutate({ id: line.contributionId });
              }}
            >
              {t('settle.nudge')}
            </Button>
          ) : null}
        </>
      ) : line.settlement === 'DUE' ? (
        <Button
          variant="secondary"
          disabled={claim.isPending}
          onClick={() => {
            claim.mutate({ id: line.contributionId });
          }}
        >
          {t('settle.claim')}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** CPT-68, CPT-75 : propositions de compensation reçues (à confirmer) et envoyées. */
export function OffsetProposals() {
  const t = useTranslations('accounting');
  const locale = useLocale();
  const refresh = useAccountingRefresh();
  const { data } = useListOffsetProposals();
  const [error, setError] = useState<string | null>(null);
  const key = useIdempotencyKey();
  const handlers: Handlers = {
    onDone: () => {
      setError(null);
      refresh();
    },
    onError: () => {
      setError(t('offset.stale'));
      refresh();
    },
  };
  const confirm = useConfirmOffset(withKey(key, handlers));
  const decline = useDeclineOffset(withKey(key, handlers));
  if (!data || data.items.length === 0) return null;
  return (
    <section aria-label={t('offset.title')} className="flex flex-col gap-2">
      <h2 className="font-medium">{t('offset.title')}</h2>
      <ul className="flex flex-col gap-2">
        {data.items.map((proposal) => {
          const name = proposal.other?.displayName ?? t('someone');
          const amount = formatMinor(proposal.amountMinor, proposal.currency, locale);
          return (
            <li
              key={proposal.id}
              className="flex flex-col gap-2 rounded-md border border-border p-3"
            >
              <p>
                {proposal.direction === 'RECEIVED'
                  ? t('offset.received', { name, amount })
                  : t('offset.sent', { name, amount })}
              </p>
              <div className="flex gap-2">
                {proposal.direction === 'RECEIVED' ? (
                  <Button
                    disabled={confirm.isPending}
                    onClick={() => {
                      confirm.mutate({ id: proposal.id });
                    }}
                  >
                    {t('offset.confirm')}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  disabled={decline.isPending}
                  onClick={() => {
                    decline.mutate({ id: proposal.id });
                  }}
                >
                  {proposal.direction === 'RECEIVED' ? t('offset.decline') : t('offset.withdraw')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * CPT-40, CPT-69 : budget privé d'un événement, global ou par destinataire. Jamais bloquant
 * (CPT-43) ; seul son profil le lit.
 */
export function BudgetEditor({
  eventId,
  currency,
  groups,
}: {
  eventId: string;
  currency: string;
  groups: readonly OverviewGroupView[];
}) {
  const t = useTranslations('accounting');
  const refresh = useAccountingRefresh();
  const { data } = useListBudgets({ eventId });
  const [error, setError] = useState<string | null>(null);
  const handlers = {
    mutation: {
      onSuccess: () => {
        setError(null);
        refresh();
      },
      onError: () => {
        setError(t('errors.generic'));
      },
    },
  };
  const put = usePutBudget(handlers);
  const remove = useDeleteBudget(handlers);
  const recipients = groups.flatMap((g) => (g.recipients.length === 1 ? g.recipients : []));
  const rows: { recipientId: string | null; label: string }[] = [
    { recipientId: null, label: t('budgets.event') },
    ...recipients.map((p) => ({ recipientId: p.id, label: p.displayName })),
  ];
  return (
    <details className="rounded-md border border-border p-2 text-sm">
      <summary className="min-h-touch cursor-pointer content-center">{t('budgets.title')}</summary>
      <p className="pt-2 text-foreground-muted">{t('budgetPrivate')}</p>
      <ul className="flex flex-col gap-2 pt-2">
        {rows.map((row) => {
          const budget = data?.items.find((b) => b.recipientId === row.recipientId);
          return (
            <li key={row.recipientId ?? 'event'}>
              <BudgetRow
                label={row.label}
                amountMinor={budget?.amountMinor ?? null}
                currency={budget?.currency ?? currency}
                busy={put.isPending || remove.isPending}
                onSave={(amountMinor) => {
                  put.mutate({
                    data: { eventId, recipientId: row.recipientId, amountMinor, currency },
                  });
                }}
                {...(budget
                  ? {
                      onRemove: () => {
                        remove.mutate({ id: budget.id });
                      },
                    }
                  : {})}
              />
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
    </details>
  );
}

function BudgetRow({
  label,
  amountMinor,
  currency,
  busy,
  onSave,
  onRemove,
}: {
  label: string;
  amountMinor: number | null;
  currency: string;
  busy: boolean;
  onSave: (amountMinor: number) => void;
  onRemove?: () => void;
}) {
  const t = useTranslations('accounting');
  const locale = useLocale();
  const id = useId();
  const [value, setValue] = useState('');
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const minor = parseAmount(value);
    if (minor !== null && minor > 0) {
      onSave(minor);
      setValue('');
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id}>
          {label}
          {amountMinor !== null ? ` · ${formatMinor(amountMinor, currency, locale)}` : ''}
        </Label>
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
        />
      </div>
      <Button type="submit" variant="secondary" disabled={busy}>
        {t('budgets.save')}
      </Button>
      {onRemove ? (
        <Button type="button" variant="ghost" disabled={busy} onClick={onRemove}>
          {t('budgets.remove')}
        </Button>
      ) : null}
    </form>
  );
}
