'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  AddRight,
  getListItemsQueryKey,
  useAddListItem,
  useCreateProduct,
  useCreateProductFromPhoto,
} from '@wishlist/api-client';
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
  const add = useAddListItem();
  const suggestion = right === AddRight.suggestion;
  const busy = create.isPending || fromPhoto.isPending || add.isPending;
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
    create.mutate(
      {
        data: {
          title: text(form, 'title').trim(),
          ...(unitPriceMinor !== null ? { unitPriceMinor } : {}),
        },
      },
      {
        onSuccess: (product) => {
          add.mutate(
            { id: listId, data: { productId: product.id } },
            {
              onSuccess: () => {
                formElement.reset();
                void queryClient.invalidateQueries({ queryKey: getListItemsQueryKey(listId) });
              },
              onError,
            },
          );
        },
        onError,
      },
    );
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
        {mode === 'photo' ? (
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
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            {busy ? t('adding') : t('submit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
