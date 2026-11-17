'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  getListOffsetProposalsQueryKey,
  useGetAccountingOverview,
  useGetBalances,
  useGetCart,
  useGetSession,
  useProposeOffset,
} from '@wishlist/api-client';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatMinor } from '@/features/lists/format';
import { AnimatedAmount, FundingGauge } from '@/lib/motion/moments';
import { BudgetEditor, OffsetProposals, SettlementActions } from './accounting-extras';

/** CPT-11 : panier de l'acheteur, par événement puis par destinataire. */
export function CartScreen() {
  const t = useTranslations('accounting');
  const locale = useLocale();
  const { data } = useGetCart();
  if (!data) return <p className="text-foreground-muted">{t('loading')}</p>;
  if (data.groups.length === 0) return <p>{t('cartEmpty')}</p>;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t('cart')}</h1>
      {data.groups.map((group, index) => (
        <section key={index} className="flex flex-col gap-2">
          <h2 className="font-medium">
            {group.event?.title ?? t('noEvent')} ·{' '}
            {group.recipients.map((p) => p.displayName).join(', ') || t('noRecipient')}
          </h2>
          <ul className="flex flex-col gap-2">
            {group.items.map((line) => (
              <li key={line.accountingId} className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium">
                  {line.sourceUrl ? (
                    <a
                      href={line.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      {line.title}
                    </a>
                  ) : (
                    line.title
                  )}
                </p>
                <p>
                  {line.totalMinor !== null
                    ? t('funding', {
                        covered: formatMinor(line.coveredMinor, line.currency, locale),
                        total: formatMinor(line.totalMinor, line.currency, locale),
                      })
                    : t('noPrice')}
                </p>
                {line.remainingMinor ? (
                  <p>
                    {t('remainingForYou', {
                      amount: formatMinor(line.remainingMinor, line.currency, locale),
                    })}
                  </p>
                ) : null}
                <p>{line.purchased ? t('purchased') : t('notPurchased')}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** CPT-30, CPT-31, CPT-68 : comptes avec chaque profil, et compensation. */
export function BalancesScreen() {
  const t = useTranslations('accounting');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { data } = useGetBalances();
  const { data: session } = useGetSession();
  const viewerId = session?.authenticated ? (session.session?.activeProfileId ?? null) : null;
  const [proposalId, setProposalId] = useState<string | null>(null);
  const propose = useProposeOffset({
    mutation: {
      onSuccess: (r) => {
        setProposalId(r.id);
        void queryClient.invalidateQueries({ queryKey: getListOffsetProposalsQueryKey() });
      },
    },
  });
  if (!data) return <p className="text-foreground-muted">{t('loading')}</p>;
  if (data.items.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p>{t('balancesEmpty')}</p>
        <OffsetProposals />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('balances')}</h1>
      <p className="text-sm text-foreground-muted">{t('balancesPrivate')}</p>
      <OffsetProposals />
      <ul className="flex flex-col gap-3">
        {data.items.map((balance) => {
          const name = balance.other?.displayName ?? t('someone');
          const amount = formatMinor(Math.abs(balance.netMinor), balance.currency, locale);
          return (
            <li
              key={`${balance.other?.id ?? ''}-${balance.currency}`}
              className="rounded-md border border-border p-3"
            >
              <p>
                {balance.netMinor > 0
                  ? t('youOwe', { name, amount })
                  : balance.netMinor < 0
                    ? t('owesYou', { name, amount })
                    : t('even', { name })}
              </p>
              {/* CPT-20 à CPT-23 : chaque part, avec le geste qui revient au profil. */}
              <ul className="flex flex-col gap-2 py-2 text-sm">
                {balance.lines.map((line) => (
                  <li key={line.contributionId} className="flex flex-col gap-1">
                    <span>
                      {line.title} · {formatMinor(line.owedMinor, balance.currency, locale)} ·{' '}
                      {t(`settlement.${line.settlement}`)}
                    </span>
                    {viewerId ? <SettlementActions line={line} viewerId={viewerId} /> : null}
                  </li>
                ))}
              </ul>
              {balance.iOweMinor > 0 && balance.owesMeMinor > 0 && balance.other ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    propose.mutate({
                      data: { counterpartId: balance.other?.id ?? '', currency: balance.currency },
                    });
                  }}
                >
                  {t('proposeOffset')}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {proposalId ? <p role="status">{t('offsetProposed')}</p> : null}
    </div>
  );
}

/** CPT-41 à CPT-45 : vue latérale, hiérarchie destinataire → élément, budget jamais bloquant. */
export function OverviewScreen({ eventId }: { eventId?: string }) {
  const t = useTranslations('accounting');
  const locale = useLocale();
  const { data } = useGetAccountingOverview(eventId ? { eventId } : undefined);
  if (!data) return <p className="text-foreground-muted">{t('loading')}</p>;
  const engaged = data.engaged[0];
  const over =
    data.budget &&
    engaged &&
    engaged.currency === data.budget.currency &&
    engaged.amountMinor > data.budget.amountMinor;
  return (
    <aside aria-label={t('overview')} className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{data.event?.title ?? t('overview')}</h1>
      <p className="text-sm text-foreground-muted">{t('budgetPrivate')}</p>
      {data.budget ? (
        <p>
          {t('budget', {
            amount: formatMinor(data.budget.amountMinor, data.budget.currency, locale),
          })}
          {/* CPT-43 : dépasser n'est jamais bloquant ; un libellé l'indique, pas la couleur seule. */}
          {over ? ` · ${t('overBudget')}` : ''}
        </p>
      ) : null}
      {data.engaged.map((m) => (
        <p key={m.currency}>
          {/* CPT-43 : le total s'incrémente jusqu'à sa nouvelle valeur. */}
          <AnimatedAmount
            value={m.amountMinor}
            format={(v) => t('engaged', { amount: formatMinor(v, m.currency, locale) })}
          />
        </p>
      ))}
      {data.budget && engaged && engaged.currency === data.budget.currency ? (
        <FundingGauge
          covered={engaged.amountMinor}
          total={data.budget.amountMinor}
          label={t('budgetGauge')}
        />
      ) : null}
      {data.event ? (
        <BudgetEditor
          eventId={data.event.id}
          currency={data.budget?.currency ?? data.engaged[0]?.currency ?? 'EUR'}
          groups={data.groups}
        />
      ) : null}
      {data.groups.map((group, index) => (
        <section key={index} className="flex flex-col gap-1">
          <h2 className="font-medium">
            {group.month ??
              (group.recipients.map((p) => p.displayName).join(', ') || t('noRecipient'))}
          </h2>
          <ul className="text-sm">
            {group.lines.map((line) => (
              <li key={line.accountingId}>
                {line.title} · {t(`mode.${line.mode}`)}
                {line.amountMinor !== null
                  ? ` · ${formatMinor(line.amountMinor, line.currency, locale)}`
                  : ''}
                {line.isBuyer
                  ? ` · ${t('iBuy')}`
                  : line.buyer
                    ? ` · ${t('payTo', { name: line.buyer.displayName })}`
                    : ''}
                {line.purchased ? ` · ${t('purchased')}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {data.nothingYet.length > 0 ? (
        <section>
          <h2 className="font-medium">{t('nothingYet')}</h2>
          <p className="text-sm">{data.nothingYet.map((p) => p.displayName).join(', ')}</p>
        </section>
      ) : null}
    </aside>
  );
}
