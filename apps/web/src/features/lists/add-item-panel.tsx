'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  AddRight,
  getListItemsQueryKey,
  useCreateProduct,
  useCreateProductFromPhoto,
} from '@wishlist/api-client';
import { offlineActions } from '@/lib/offline/actions';
import { useIsOnline } from '@/lib/offline/offline-provider';
import type { QueuedInput } from '@/lib/offline/queue';
import { useOfflineAction, useQueuedActions } from '@/lib/offline/queue-context';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { listErrorKey } from './api-errors';
import { parseMinor } from './format';

type Mode = 'link' | 'photo' | 'hand';

/**
 * Trois manières d'ajouter (EXT-01, EXT-10, EXT-20). Par lien ou photo, la fiche passe par le
 * brouillon (EXT-04) avant d'entrer dans la liste ; à la main, elle y entre aussitôt.
 */
export function AddItemPanel({
  listId,
  right,
  isGiftlist,
}: {
  listId: string;
  right: AddRight;
  isGiftlist: boolean;
}) {
  const t = useTranslations('add');
  const te = useTranslations('lists.errors');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('link');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateProduct();
  const fromPhoto = useCreateProductFromPhoto();
  const perform = useOfflineAction();
  const online = useIsOnline();
  const [adding, setAdding] = useState(false);
  // OFF-10 : souhaits ajoutés hors ligne, « en attente d'envoi ».
  const waiting = useQueuedActions().filter(
    (a) => a.kind === 'item.add' && a.subject.listId === listId && a.state === 'pending',
  );
  const suggestion = right === AddRight.suggestion;
  const busy = create.isPending || fromPhoto.isPending || adding;
  const onError = (e: unknown) => {
    setError(te(listErrorKey(e)));
  };

  const toDraft = (productId: string) => {
    router.push(`/products/${productId}?list=${listId}`);
  };

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setError(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const queueOrSend = (input: QueuedInput) => {
      setAdding(true);
      perform(input)
        .then((outcome) => {
          formElement.reset();
          if (!outcome.queued) {
            void queryClient.invalidateQueries({ queryKey: getListItemsQueryKey(listId) });
          }
        })
        .catch(onError)
        .finally(() => {
          setAdding(false);
        });
    };
    if (mode === 'link' && !online) {
      queueOrSend(offlineActions.addByLink(listId, text(form, 'url').trim()));
      return;
    }
    if (mode === 'link') {
      create.mutate(
        { data: { url: text(form, 'url').trim() } },
        {
          onSuccess: (p) => {
            toDraft(p.id);
          },
          onError,
        },
      );
      return;
    }
    if (mode === 'photo') {
      const photo = form.get('photo');
      if (!(photo instanceof File) || photo.size === 0) return;
      fromPhoto.mutate(
        { data: { photo } },
        {
          onSuccess: (p) => {
            toDraft(p.id);
          },
          onError,
        },
      );
      return;
    }
    const priceText = text(form, 'price').trim();
    const unitPriceMinor = priceText ? parseMinor(priceText, 'EUR', locale) : null;
    queueOrSend(offlineActions.addByHand(listId, text(form, 'title').trim(), unitPriceMinor));
  }

  return (
    <Card>
      <CardTitle>
        {suggestion ? t('titleSuggestion') : isGiftlist ? t('titleGift') : t('title')}
      </CardTitle>
      <CardDescription className="mt-1">
        {suggestion ? t('suggestionWho') : t('who')}
      </CardDescription>
      <div role="group" className="mt-3 flex flex-wrap gap-1">
        {(['link', 'photo', 'hand'] as const).map((value) => (
          <Button
            key={value}
            variant={mode === value ? 'primary' : 'ghost'}
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
            }}
          >
            {value === 'link' ? t('byLink') : value === 'photo' ? t('byPhoto') : t('byHand')}
          </Button>
        ))}
      </div>
      <form className="mt-3 flex flex-col gap-3" onSubmit={onSubmit}>
        {mode === 'link' ? (
          <Field
            label={t('url')}
            hint={t('urlHint')}
            name="url"
            type="url"
            required
            maxLength={2048}
          />
        ) : null}
        {mode === 'link' && !online ? (
          <p className="text-sm text-foreground-muted">{t('offlineLink')}</p>
        ) : null}
        {mode === 'photo' && !online ? (
          // UX-33 : action indisponible hors ligne, avec la raison.
          <p className="text-sm text-foreground-muted">{t('offlinePhoto')}</p>
        ) : null}
        {mode === 'photo' && online ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-photo">{t('photo')}</Label>
            <Input
              id="add-photo"
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              required
            />
            <p className="text-sm text-foreground-muted">{t('photoHint')}</p>
          </div>
        ) : null}
        {mode === 'hand' ? (
          <>
            <Field label={t('name')} name="title" required maxLength={200} />
            <Field label={t('price')} hint={t('priceHint')} name="price" inputMode="decimal" />
          </>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {waiting.length > 0 ? (
          <ul aria-label={t('waitingLabel')} className="flex flex-col gap-1 text-sm">
            {waiting.map((action) => (
              <li key={action.id} className="rounded-md border border-dashed border-border p-2">
                <span className="break-words">
                  {String(action.display.title ?? action.display.url ?? '')}
                </span>{' '}
                <span className="text-foreground-muted">· {t('waiting')}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || (mode === 'photo' && !online)}>
            {busy ? t('adding') : t('submit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
