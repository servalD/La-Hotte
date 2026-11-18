'use client';

import { AuditAction, type AuditEntryView, useListAuditEntries } from '@wishlist/api-client';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

/** Les clés de message ne portent pas de point (next-intl). */
export const actionKey = (action: string): string => action.replaceAll('.', '_');

function Page({
  action,
  cursor,
  onMore,
}: {
  action: AuditAction | null;
  cursor: string | null;
  onMore: (next: string) => void;
}) {
  const t = useTranslations('admin.audit');
  const format = useFormatter();
  const page = useListAuditEntries({
    ...(action ? { action } : {}),
    ...(cursor ? { cursor } : {}),
  });
  if (!page.data) return null;
  const next = page.data.nextCursor;
  const value = (v: AuditEntryView['after']): string =>
    v === null ? '' : typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : String(v);
  return (
    <>
      {page.data.items.length === 0 && !cursor ? <p>{t('empty')}</p> : null}
      {page.data.items.map((entry) => (
        <li
          key={entry.id}
          className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4"
        >
          <p className="font-medium">{t(`actions.${actionKey(entry.action)}`)}</p>
          <p className="text-sm text-foreground-muted">
            {format.dateTime(new Date(entry.at), { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
            {t('actor')} {entry.actorAccountId ?? t('operator')}
            {entry.ip ? ` · ${entry.ip}` : ''}
          </p>
          {entry.targetId ? (
            <p className="text-sm">
              {t('target')} {entry.targetKind} {entry.targetId}
            </p>
          ) : null}
          {entry.reason ? (
            <p className="text-sm break-words whitespace-pre-wrap">{entry.reason}</p>
          ) : null}
          {entry.before !== null || entry.after !== null ? (
            <p className="text-sm break-all text-foreground-muted">
              {value(entry.before)} → {value(entry.after)}
            </p>
          ) : null}
        </li>
      ))}
      {next ? (
        <li>
          <Button
            variant="secondary"
            onClick={() => {
              onMore(next);
            }}
          >
            {t('more')}
          </Button>
        </li>
      ) : null}
    </>
  );
}

/** AUD-04, AUD-06 : le journal, page par page ; le consulter y est écrit. */
export function AuditLog() {
  const t = useTranslations('admin.audit');
  const id = useId();
  const [action, setAction] = useState<AuditAction | null>(null);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id}>{t('filter')}</Label>
        <select
          id={id}
          value={action ?? ''}
          onChange={(e) => {
            setAction((e.target.value || null) as AuditAction | null);
            setCursors([null]);
          }}
          className="min-h-touch rounded-md border border-border bg-surface px-3"
        >
          <option value="">{t('all')}</option>
          {Object.values(AuditAction).map((a) => (
            <option key={a} value={a}>
              {t(`actions.${actionKey(a)}`)}
            </option>
          ))}
        </select>
      </div>
      <ul className="flex flex-col gap-2">
        {cursors.map((cursor, i) => (
          <Page
            key={`${action ?? 'all'}-${String(i)}`}
            action={action}
            cursor={cursor}
            onMore={(next) => {
              if (i === cursors.length - 1) setCursors([...cursors, next]);
            }}
          />
        ))}
      </ul>
    </div>
  );
}
