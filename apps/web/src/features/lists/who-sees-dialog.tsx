'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  getGetItemRuleQueryKey,
  getListItemsQueryKey,
  useGetCircle,
  useGetItemRule,
  useListMembers,
  useSetItemRule,
  VisibilityMode,
} from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { listErrorKey } from './api-errors';

type Mode = (typeof VisibilityMode)[keyof typeof VisibilityMode];

/**
 * VIS-10 à VIS-15 : « Qui voit ça ? ». Choix multiple parmi le cercle et les membres (VIS-19),
 * interrupteur « Seulement eux / Tous sauf eux » qui garde la sélection (VIS-13), et la différence
 * pratique entre les deux expliquée en une ligne (VIS-15). Le serveur seul décide (VIS-30).
 */
export function WhoSeesDialog({ itemId, listId }: { itemId: string; listId: string }) {
  const t = useTranslations('whoSees');
  const te = useTranslations('lists.errors');
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">{t('title')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('title')}</DialogTitle>
        {open ? (
          <RuleForm
            itemId={itemId}
            listId={listId}
            onDone={() => {
              setOpen(false);
            }}
            errorText={te}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RuleForm({
  itemId,
  listId,
  onDone,
  errorText,
}: {
  itemId: string;
  listId: string;
  onDone: () => void;
  errorText: (key: string) => string;
}) {
  const t = useTranslations('whoSees');
  const queryClient = useQueryClient();
  const rule = useGetItemRule(itemId);
  const circle = useGetCircle();
  const members = useListMembers(listId);
  const [mode, setMode] = useState<Mode | null>(null);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = useSetItemRule({
    request: { headers: { 'If-Match': `"${rule.data?.version ?? 0}"` } },
  });

  if (rule.isError) return <p role="alert">{errorText(listErrorKey(rule.error))}</p>;
  if (!rule.data) return <p>…</p>;

  const currentMode = mode ?? rule.data.mode;
  const picked = selected ?? rule.data.profiles;
  const names = new Map((circle.data?.items ?? []).map((m) => [m.profileId, m.displayName]));
  const candidates = [
    ...new Set([
      ...(circle.data?.items ?? []).map((m) => m.profileId),
      ...(members.data?.items ?? []).map((m) => m.profileId),
    ]),
  ].filter((id) => names.has(id));

  function save() {
    setError(null);
    set.mutate(
      {
        id: itemId,
        data: { mode: currentMode, profileIds: currentMode === VisibilityMode.ALL ? [] : picked },
      },
      {
        onSuccess: (result) => {
          void queryClient.invalidateQueries({ queryKey: getGetItemRuleQueryKey(itemId) });
          void queryClient.invalidateQueries({ queryKey: getListItemsQueryKey(listId) });
          if (result.outsideAudience.length === 0) onDone();
          else setError(t('outside'));
        },
        onError: (e) => {
          setError(errorText(listErrorKey(e)));
        },
      },
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t('modeLabel')}</legend>
        {[VisibilityMode.ALL, VisibilityMode.ONLY, VisibilityMode.EXCEPT].map((value) => (
          <label key={value} className="flex min-h-touch items-center gap-2">
            <input
              type="radio"
              name="mode"
              checked={currentMode === value}
              onChange={() => {
                setMode(value);
              }}
            />
            {value === VisibilityMode.ALL
              ? t('everyone')
              : value === VisibilityMode.ONLY
                ? t('only')
                : t('except')}
          </label>
        ))}
      </fieldset>
      {currentMode !== VisibilityMode.ALL ? (
        <>
          <DialogDescription>
            {currentMode === VisibilityMode.ONLY ? t('hintOnly') : t('hintExcept')}
          </DialogDescription>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{t('pick')}</legend>
            {candidates.map((id) => (
              <label key={id} className="flex min-h-touch items-center gap-2">
                <input
                  type="checkbox"
                  checked={picked.includes(id)}
                  onChange={() => {
                    setSelected(
                      picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id],
                    );
                  }}
                />
                {names.get(id)}
              </label>
            ))}
          </fieldset>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          {t('cancel')}
        </Button>
        <Button onClick={save} disabled={set.isPending}>
          {t('save')}
        </Button>
      </div>
    </div>
  );
}
