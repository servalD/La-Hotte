'use client';

import {
  ApiError,
  ReportReason,
  type ReportTargetKind,
  useReportContent,
} from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { text } from '@/features/auth/form-data';

const KNOWN = new Set(['REPORT_OWN_CONTENT', 'REPORT_TARGET_NOT_FOUND']);

/**
 * MOD-07, COM-10 : signaler une fiche ou un message. La fenêtre dit qui lira (UX-04) : la seule
 * modération, sans que l'auteur sache qui a signalé.
 */
export function ReportButton({
  targetKind,
  targetId,
}: {
  targetKind: ReportTargetKind;
  targetId: string;
}) {
  const t = useTranslations('report');
  const reasonId = useId();
  const noteId = useId();
  const report = useReportContent();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const note = text(form, 'note').trim();
    report.mutate(
      {
        data: {
          targetKind,
          targetId,
          reason: text(form, 'reason') as ReportReason,
          ...(note ? { note } : {}),
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          setMessage(t('sent'));
        },
        onError: (e) => {
          const code = e instanceof ApiError ? e.problem.code : '';
          setMessage(t(`errors.${KNOWN.has(code) ? code : 'generic'}`));
        },
      },
    );
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setMessage(null);
        }}
      >
        <DialogTrigger asChild>
          <Button variant="ghost">{t('open')}</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription className="mb-4">{t('who')}</DialogDescription>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={reasonId}>{t('reason')}</Label>
              <select
                id={reasonId}
                name="reason"
                required
                className="min-h-touch rounded-md border border-border bg-surface px-3"
              >
                {Object.values(ReportReason).map((reason) => (
                  <option key={reason} value={reason}>
                    {t(`reasons.${reason}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={noteId}>{t('note')}</Label>
              <textarea
                id={noteId}
                name="note"
                maxLength={500}
                className="min-h-20 rounded-md border border-border bg-surface p-2"
              />
            </div>
            {message ? (
              <p role="alert" className="text-sm text-danger">
                {message}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  {t('cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={report.isPending}>
                {t('send')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {!open && message ? (
        <span role="status" className="text-sm text-foreground-muted">
          {message}
        </span>
      ) : null}
    </>
  );
}
