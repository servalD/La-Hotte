'use client';

import { ReportButton } from '@/features/moderation/report-button';
import { useQueryClient } from '@tanstack/react-query';
import {
  CommentReaction,
  CommentThread,
  type CommentView,
  getGetItemThreadsQueryKey,
  getListItemCommentsQueryKey,
  useAddCommentReaction,
  useDeleteOneComment,
  useFollowOneItem,
  useGetItemThreads,
  useListItemComments,
  useRemoveCommentReaction,
  useUnfollowOneItem,
} from '@wishlist/api-client';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { type SyntheticEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { AnimatePresence, motion } from 'motion/react';
import { useMotionPreset } from '@/lib/motion/presets';
import { offlineActions } from '@/lib/offline/actions';
import { useOfflineAction, usePendingFor } from '@/lib/offline/queue-context';
import { cn } from '@/lib/utils/cn';
import { useRealtime, useRealtimeRooms } from '@/lib/realtime/realtime-provider';
import { formatMinor } from '@/features/lists/format';
import { LightMarkdown } from './light-markdown';

type Thread = (typeof CommentThread)[keyof typeof CommentThread];

const REACTION_ICONS: Record<keyof typeof CommentReaction, string> = {
  THUMBS_UP: '👍',
  HEART: '❤️',
  LAUGH: '😄',
  WOW: '😮',
  PARTY: '🎉',
  THANKS: '🙏',
};

/** Bouton « Discussion » d'un élément : ouvre ses fils (COM-01 à COM-03). */
export function ItemThreadsButton({ itemId, title }: { itemId: string; title: string }) {
  const t = useTranslations('threads');
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">{t('open')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('title', { item: title })}</DialogTitle>
        {open ? <ItemThreads itemId={itemId} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * COM-02, COM-03, COM-12 : l'API dit quels fils existent pour le profil ; un destinataire n'a ni
 * onglet ni compteur du fil Offreurs. Pour un offreur, le fil Offreurs est ouvert par défaut, sur un
 * fond distinct, et la saisie rappelle toujours qui lira.
 */
export function ItemThreads({ itemId }: { itemId: string }) {
  const t = useTranslations('threads');
  const queryClient = useQueryClient();
  const { data: threads } = useGetItemThreads(itemId);
  const giver = threads?.view === 'giver' ? threads : null;
  const [chosen, setChosen] = useState<Thread | null>(null);
  const thread: Thread | null =
    chosen ?? (giver ? CommentThread.GIVERS : threads ? CommentThread.PUBLIC : null);
  useRealtimeRooms(
    giver
      ? [`item:${itemId}:givers`, ...(giver.public ? [`item:${itemId}:public`] : [])]
      : threads
        ? [`item:${itemId}:public`]
        : [],
  );
  const follow = useFollowOneItem();
  const unfollow = useUnfollowOneItem();
  if (!threads || !thread) return <p role="status">{t('loading')}</p>;

  const refreshThreads = () =>
    void queryClient.invalidateQueries({ queryKey: getGetItemThreadsQueryKey(itemId) });

  return (
    <div className="flex flex-col gap-3">
      {giver ? (
        <div role="tablist" aria-label={t('tabs')} className="flex gap-2">
          <Button
            role="tab"
            aria-selected={thread === CommentThread.GIVERS}
            variant={thread === CommentThread.GIVERS ? 'primary' : 'secondary'}
            onClick={() => {
              setChosen(CommentThread.GIVERS);
            }}
          >
            <span aria-hidden="true">🔒 </span>
            {t('givers', { count: giver.givers.count })}
          </Button>
          {giver.public ? (
            <Button
              role="tab"
              aria-selected={thread === CommentThread.PUBLIC}
              variant={thread === CommentThread.PUBLIC ? 'primary' : 'secondary'}
              onClick={() => {
                setChosen(CommentThread.PUBLIC);
              }}
            >
              {t('public', { count: giver.public.count })}
            </Button>
          ) : (
            <p className="self-center text-sm text-foreground-muted">{t('publicClosed')}</p>
          )}
        </div>
      ) : null}
      <ThreadView
        itemId={itemId}
        thread={thread}
        canWrite={
          giver
            ? thread === CommentThread.GIVERS
              ? giver.givers.canWrite
              : (giver.public?.canWrite ?? false)
            : threads.view === 'recipient' && threads.public.canWrite
        }
        audienceKey={
          thread === CommentThread.GIVERS
            ? 'audienceGivers'
            : giver
              ? 'audienceAll'
              : 'audienceSelf'
        }
      />
      <Button
        variant="ghost"
        onClick={() => {
          (threads.following ? unfollow : follow).mutate(
            { id: itemId },
            { onSuccess: refreshThreads },
          );
        }}
      >
        {threads.following ? t('unfollow') : t('follow')}
      </Button>
    </div>
  );
}

function ThreadView({
  itemId,
  thread,
  canWrite,
  audienceKey,
}: {
  itemId: string;
  thread: Thread;
  canWrite: boolean;
  audienceKey: 'audienceGivers' | 'audienceAll' | 'audienceSelf';
}) {
  const t = useTranslations('threads');
  const queryClient = useQueryClient();
  const params = { thread };
  const { data, isPending } = useListItemComments(itemId, params);
  const perform = useOfflineAction();
  const arrive = useMotionPreset('arriveFromBelow');
  const [sending, setSending] = useState(false);
  // OFF-10, UX-32 : un commentaire écrit hors ligne s'affiche « en attente d'envoi ».
  const waiting = usePendingFor(itemId).filter(
    (a) => a.kind === 'comment.post' && a.subject.thread === thread,
  );
  const [error, setError] = useState<string | null>(null);
  const { emit } = useRealtime();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListItemCommentsQueryKey(itemId, params) });
    void queryClient.invalidateQueries({ queryKey: getGetItemThreadsQueryKey(itemId) });
  };
  // RT-05 : présence dans le fil Offreurs seulement.
  useEffect(() => {
    if (thread !== CommentThread.GIVERS) return undefined;
    emit('presence', { itemId, present: true });
    return () => {
      emit('presence', { itemId, present: false });
    };
  }, [emit, itemId, thread]);

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form).get('body');
    if (typeof body !== 'string' || body.trim().length === 0) return;
    setSending(true);
    perform(offlineActions.comment(itemId, thread, body))
      .then((outcome) => {
        form.reset();
        setError(null);
        if (!outcome.queued) refresh();
      })
      .catch(() => {
        setError(t('error'));
      })
      .finally(() => {
        setSending(false);
      });
  }

  const messages = [...(data?.items ?? [])].reverse();
  return (
    <section
      aria-label={t(thread === CommentThread.GIVERS ? 'giversLabel' : 'publicLabel')}
      className={cn(
        'flex flex-col gap-3 rounded-md p-3',
        thread === CommentThread.GIVERS ? 'bg-surface-muted' : 'bg-surface',
      )}
    >
      {isPending ? <p role="status">{t('loading')}</p> : null}
      {!isPending && messages.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('empty')}</p>
      ) : null}
      <ol className="flex flex-col gap-2">
        {/* « Nouveau commentaire en direct » : glisse depuis le bas ; pas au premier affichage. */}
        <AnimatePresence initial={false}>
          {messages.map((comment) => (
            <motion.li
              key={comment.id}
              variants={arrive}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <Message comment={comment} onChanged={refresh} />
            </motion.li>
          ))}
        </AnimatePresence>
        {waiting.map((action) => (
          <li key={action.id} className="rounded-md border border-dashed border-border p-2 text-sm">
            <p className="break-words whitespace-pre-wrap">{String(action.display.body ?? '')}</p>
            <p className="text-foreground-muted">{t('pendingSend')}</p>
          </li>
        ))}
      </ol>
      {canWrite ? (
        <form className="flex flex-col gap-2" onSubmit={onSubmit}>
          <Label htmlFor={`body-${itemId}-${thread}`}>{t('write')}</Label>
          <textarea
            id={`body-${itemId}-${thread}`}
            name="body"
            maxLength={2000}
            required
            rows={3}
            className="rounded-md border border-border-strong bg-surface p-2"
            aria-describedby={`audience-${itemId}-${thread}`}
            onInput={() => {
              if (thread === CommentThread.GIVERS) emit('typing', { itemId });
            }}
          />
          {/* COM-02, UX-04 : qui lira, toujours affiché. */}
          <p id={`audience-${itemId}-${thread}`} className="text-sm font-medium">
            <span aria-hidden="true">{thread === CommentThread.GIVERS ? '🔒 ' : '👁 '}</span>
            {t(audienceKey)}
          </p>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={sending}>
            {t('send')}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-foreground-muted">{t('readOnly')}</p>
      )}
    </section>
  );
}

function Message({ comment, onChanged }: { comment: CommentView; onChanged: () => void }) {
  const t = useTranslations('threads');
  const tm = useTranslations('moderationNotice');
  const format = useFormatter();
  const locale = useLocale();
  const remove = useDeleteOneComment();
  const react = useAddCommentReaction();
  const unreact = useRemoveCommentReaction();
  const when = format.relativeTime(new Date(comment.createdAt));

  if (comment.kind === 'ACTIVITY' && comment.activity) {
    const a = comment.activity;
    return (
      <p className="text-sm text-foreground-muted">
        <span aria-hidden="true">• </span>
        {t(`activity.${a.code}`, {
          who: comment.author?.displayName ?? t('someone'),
          before:
            a.beforeMinor === null
              ? t('noPrice')
              : formatMinor(a.beforeMinor, a.currency ?? 'EUR', locale),
          after:
            a.afterMinor === null
              ? t('noPrice')
              : formatMinor(a.afterMinor, a.currency ?? 'EUR', locale),
        })}{' '}
        · {when}
      </p>
    );
  }
  return (
    <article className="flex flex-col gap-1 rounded-md border border-border p-2">
      <p className="text-sm font-semibold">
        {comment.author?.displayName ?? t('someone')}{' '}
        <span className="font-normal text-foreground-muted">
          · {when}
          {comment.editedAt ? ` · ${t('edited')}` : ''}
        </span>
      </p>
      {comment.deleted ? (
        <p className="text-sm text-foreground-muted italic">{t('deleted')}</p>
      ) : comment.moderation !== 'NONE' ? (
        // MOD-08, MOD-10 : l'API rend un texte vide ; l'interface dit pourquoi.
        <p className="text-sm text-foreground-muted italic">{tm(comment.moderation)}</p>
      ) : (
        <LightMarkdown text={comment.body} />
      )}
      {!comment.deleted && comment.moderation === 'NONE' ? (
        <div className="flex flex-wrap items-center gap-1">
          {(Object.keys(REACTION_ICONS) as (keyof typeof CommentReaction)[]).map((reaction) => {
            const count = comment.reactions.find((r) => r.reaction === reaction);
            const mine = count?.mine ?? false;
            return (
              <Button
                key={reaction}
                variant={mine ? 'secondary' : 'ghost'}
                aria-pressed={mine}
                aria-label={t(`reactions.${reaction}`)}
                onClick={() => {
                  (mine ? unreact : react).mutate(
                    { id: comment.id, reaction: CommentReaction[reaction] },
                    { onSuccess: onChanged },
                  );
                }}
              >
                <span aria-hidden="true">{REACTION_ICONS[reaction]}</span>
                {count ? ` ${String(count.count)}` : ''}
              </Button>
            );
          })}
          {!comment.mine ? <ReportButton targetKind="COMMENT" targetId={comment.id} /> : null}
          {comment.canDelete ? (
            <Button
              variant="ghost"
              onClick={() => {
                remove.mutate({ id: comment.id }, { onSuccess: onChanged });
              }}
            >
              {t('delete')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
