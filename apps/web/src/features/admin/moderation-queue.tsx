'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  type CommentUnderReviewView,
  ContestOutcome,
  getGetModerationQueueQueryKey,
  ModerationDecision,
  type ModerationQueueViewItemsItem,
  type OpenReportsView,
  type ProductUnderReviewView,
  useDecideModeration,
  useDecideModerationContest,
  useGetModerationQueue,
} from '@wishlist/api-client';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProfileImage } from '@/lib/offline/profile-image';
import { adminErrorKey } from './api-errors';
import { ReasonActions } from './reason-actions';

function Reports({ reports }: { reports: OpenReportsView | null }) {
  const t = useTranslations('admin.moderation');
  const tr = useTranslations('report.reasons');
  if (!reports) return <p className="text-sm text-foreground-muted">{t('pending')}</p>;
  const total = reports.reasons.reduce((sum, r) => sum + r.count, 0);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="font-medium">{t('reports', { count: total })}</p>
      <ul className="list-inside list-disc">
        {reports.reasons.map((r) => (
          <li key={r.reason}>
            {tr(r.reason)} × {r.count}
          </li>
        ))}
      </ul>
      {reports.notes.length > 0 ? (
        <>
          <p className="font-medium">{t('notes')}</p>
          <ul className="flex flex-col gap-1">
            {reports.notes.map((note, i) => (
              // Texte d'un signaleur : affiché tel quel, jamais interprété (invariant 6).
              <li key={i} className="rounded-md bg-surface-muted p-2 whitespace-pre-wrap">
                {note}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function Product({ product }: { product: ProductUnderReviewView }) {
  const t = useTranslations('admin.moderation');
  return (
    <div className="flex gap-3">
      {product.imageKey ? (
        <ProfileImage
          imageKey={product.imageKey}
          width={80}
          height={80}
          className="size-20 rounded-md object-cover"
        />
      ) : null}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-semibold break-words">{product.title}</p>
        {product.description ? (
          <p className="text-sm break-words whitespace-pre-wrap">{product.description}</p>
        ) : null}
        {product.merchant ? <p className="text-sm">{product.merchant}</p> : null}
        {product.sourceUrl ? (
          <a
            className="text-sm break-all underline"
            href={product.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {product.sourceUrl}
          </a>
        ) : null}
        <p className="text-sm text-foreground-muted">{t(`status.${product.status}`)}</p>
      </div>
    </div>
  );
}

function Comment({ comment }: { comment: CommentUnderReviewView }) {
  const t = useTranslations('admin.moderation');
  const format = useFormatter();
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-foreground-muted">
        {t(`thread.${comment.thread}`)} ·{' '}
        {format.dateTime(new Date(comment.createdAt), { dateStyle: 'medium' })}
      </p>
      <p className="rounded-md bg-surface-muted p-2 break-words whitespace-pre-wrap">
        {comment.body}
      </p>
    </div>
  );
}

function Entry({ entry, onDone }: { entry: ModerationQueueViewItemsItem; onDone: () => void }) {
  const t = useTranslations('admin.moderation');
  const te = useTranslations('admin.errors');
  const decide = useDecideModeration();
  const contest = useDecideModerationContest();
  const [message, setMessage] = useState<string | null>(null);
  const handlers = {
    onSuccess: () => {
      setMessage(t('done'));
      onDone();
    },
    onError: (e: unknown) => {
      setMessage(te(adminErrorKey(e)));
    },
  };

  if (entry.kind === 'CONTEST') {
    return (
      <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="font-semibold">{t('contest')}</h2>
        <p className="text-sm text-foreground-muted">
          {t('contested', { action: entry.decision.action, reason: entry.decision.reason })}
        </p>
        {entry.product ? <Product product={entry.product} /> : null}
        {entry.comment ? <Comment comment={entry.comment} /> : null}
        <p className="text-sm font-medium">{t('contestText')}</p>
        <p className="rounded-md bg-surface-muted p-2 break-words whitespace-pre-wrap">
          {entry.text}
        </p>
        <ReasonActions
          pending={contest.isPending}
          actions={[
            { key: ContestOutcome.UPHOLD, label: t('uphold') },
            { key: ContestOutcome.OVERTURN, label: t('overturn') },
          ]}
          onAction={(outcome, reason) => {
            contest.mutate(
              { id: entry.contestId, data: { outcome: outcome as ContestOutcome, reason } },
              handlers,
            );
          }}
        />
        {message ? <p role="status">{message}</p> : null}
      </li>
    );
  }

  const target =
    entry.kind === 'PRODUCT'
      ? { kind: 'products' as const, id: entry.product.id }
      : { kind: 'comments' as const, id: entry.comment.id };
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h2 className="font-semibold">{entry.kind === 'PRODUCT' ? t('product') : t('comment')}</h2>
      {entry.kind === 'PRODUCT' ? (
        <Product product={entry.product} />
      ) : (
        <Comment comment={entry.comment} />
      )}
      <Reports reports={entry.reports} />
      <ReasonActions
        pending={decide.isPending}
        actions={[
          { key: ModerationDecision.KEEP, label: t('keep') },
          { key: ModerationDecision.REMOVE, label: t('remove'), variant: 'danger' },
          {
            key: ModerationDecision.REMOVE_AND_SUSPEND,
            label: t('removeSuspend'),
            variant: 'danger',
          },
        ]}
        onAction={(decision, reason) => {
          decide.mutate(
            { ...target, data: { decision: decision as ModerationDecision, reason } },
            handlers,
          );
        }}
      />
      {message ? <p role="status">{message}</p> : null}
    </li>
  );
}

/** MOD-10, MOD-11, ADM-05 : la file, telle que l'API la rend. */
export function ModerationQueue() {
  const t = useTranslations('admin.moderation');
  const queryClient = useQueryClient();
  const queue = useGetModerationQueue();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetModerationQueueQueryKey() });
  };
  if (!queue.data) return null;
  if (queue.data.items.length === 0) return <p>{t('empty')}</p>;
  return (
    <ul className="flex flex-col gap-4">
      {queue.data.items.map((entry) => (
        <Entry
          key={
            entry.kind === 'CONTEST'
              ? entry.contestId
              : entry.kind === 'PRODUCT'
                ? entry.product.id
                : entry.comment.id
          }
          entry={entry}
          onDone={refresh}
        />
      ))}
    </ul>
  );
}
