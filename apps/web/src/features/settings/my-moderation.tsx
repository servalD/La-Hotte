'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  type DecisionOnMyContentView,
  getListDecisionsOnMyContentQueryKey,
  useContestModerationDecision,
  useListDecisionsOnMyContent,
} from '@wishlist/api-client';
import { useFormatter, useTranslations } from 'next-intl';
import { type SyntheticEvent, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { text } from '@/features/auth/form-data';

function Decision({ decision }: { decision: DecisionOnMyContentView }) {
  const t = useTranslations('myModeration');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const contest = useContestModerationDecision();
  const textId = useId();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    contest.mutate(
      { id: decision.id, data: { text: text(new FormData(event.currentTarget), 'text').trim() } },
      {
        onSuccess: () => {
          setOpen(false);
          setMessage(t('sent'));
          void queryClient.invalidateQueries({
            queryKey: getListDecisionsOnMyContentQueryKey(),
          });
        },
        onError: (e) => {
          setMessage(
            e instanceof ApiError && e.problem.code === 'CONTEST_NOT_ALLOWED'
              ? t('CONTEST_NOT_ALLOWED')
              : t('generic'),
          );
        },
      },
    );
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <p className="font-medium">
        {t(decision.targetKind)} · {format.dateTime(new Date(decision.at), { dateStyle: 'medium' })}
      </p>
      <p className="text-sm break-words">{t('reason', { reason: decision.reason })}</p>
      {decision.contestOutcome ? (
        <p className="text-sm font-medium">{t(`outcome.${decision.contestOutcome}`)}</p>
      ) : decision.contested ? (
        <p className="text-sm text-foreground-muted">{t('contested')}</p>
      ) : null}
      {decision.canContest && !open ? (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(true);
            }}
          >
            {t('contest')}
          </Button>
        </div>
      ) : null}
      {open ? (
        <form className="flex flex-col gap-2" onSubmit={submit}>
          <Label htmlFor={textId}>{t('contestText')}</Label>
          <textarea
            id={textId}
            name="text"
            required
            minLength={10}
            maxLength={500}
            aria-describedby={`${textId}-hint`}
            className="min-h-20 rounded-md border border-border bg-surface p-2"
          />
          <p id={`${textId}-hint`} className="text-sm text-foreground-muted">
            {t('contestHint')}
          </p>
          <div>
            <Button type="submit" disabled={contest.isPending}>
              {t('send')}
            </Button>
          </div>
        </form>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </li>
  );
}

/** MOD-11 : les retraits de mes contenus, et la contestation. */
export function MyModerationSection() {
  const t = useTranslations('myModeration');
  const decisions = useListDecisionsOnMyContent();
  return (
    <section aria-labelledby="my-moderation-title" className="flex flex-col gap-3">
      <h2 id="my-moderation-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p className="text-sm text-foreground-muted">{t('who')}</p>
      {decisions.data?.items.length === 0 ? <EmptyState compact title={t('empty')} /> : null}
      <ul className="flex flex-col gap-2">
        {decisions.data?.items.map((decision) => (
          <Decision key={decision.id} decision={decision} />
        ))}
      </ul>
    </section>
  );
}
