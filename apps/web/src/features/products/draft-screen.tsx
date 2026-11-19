'use client';

import { announceMoment } from '@/lib/pwa/engagement';
import { ProfileImage } from '@/lib/offline/profile-image';
import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  ExtractionStatus,
  getGetOwnProductQueryKey,
  HiddenItemChoice,
  type ProductView,
  ShareLevel,
  useAddListItem,
  useGetOwnProduct,
  useShareProduct,
  useUpdateProduct,
} from '@wishlist/api-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ChevronRightIcon } from '@/components/ui/icons';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { listErrorKey } from '@/features/lists/api-errors';
import { formatMinor, parseMinor } from '@/features/lists/format';

/**
 * Brouillon d'une fiche (EXT-04 à EXT-07) : relu tant que l'extraction est en cours (le temps réel
 * viendra en phase 4), champs incertains signalés, puis ajout à la liste d'où l'on vient.
 */
export function DraftScreen({ id, listId }: { id: string; listId: string | null }) {
  const t = useTranslations('draft');
  const te = useTranslations('lists.errors');
  const product = useGetOwnProduct(id, {
    query: {
      refetchInterval: (query) =>
        query.state.data?.extractionStatus === ExtractionStatus.PENDING ? 1500 : false,
    },
  });

  if (product.isPending) return <Skeleton className="h-40 w-full" aria-label={t('pending')} />;
  if (product.isError) return <p role="alert">{te(listErrorKey(product.error))}</p>;
  // La clé force un formulaire neuf quand la fiche change (fin d'extraction, enregistrement).
  return <DraftForm key={product.data.version} product={product.data} listId={listId} />;
}

function DraftForm({ product, listId }: { product: ProductView; listId: string | null }) {
  const t = useTranslations('draft');
  const te = useTranslations('lists.errors');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const update = useUpdateProduct({ request: { headers: { 'If-Match': `"${product.version}"` } } });
  const add = useAddListItem();
  const pending = product.extractionStatus === ExtractionStatus.PENDING;
  const onError = (e: unknown) => {
    setMessage(te(listErrorKey(e)));
  };
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getGetOwnProductQueryKey(product.id) });

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const priceText = text(form, 'price').trim();
    const currency = (text(form, 'currency') || product.currency).trim().toUpperCase();
    const unitPriceMinor = priceText ? parseMinor(priceText, currency, locale) : null;
    const merchant = text(form, 'merchant').trim();
    update.mutate(
      {
        id: product.id,
        data: {
          title: text(form, 'title').trim(),
          description: text(form, 'description'),
          unitPriceMinor,
          currency,
          merchant: merchant || null,
        },
      },
      {
        onSuccess: () => {
          setMessage(t('saved'));
          refresh();
        },
        onError,
      },
    );
  }

  const priceValue =
    product.unitPriceMinor === null
      ? ''
      : formatMinor(product.unitPriceMinor, product.currency, locale).replace(/[^\d,.]/g, '');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-foreground-muted">{t('who')}</p>
      </header>
      {pending ? (
        <Callout role="status" aria-live="polite">
          {t('pending')}
        </Callout>
      ) : null}
      {product.extractionStatus === ExtractionStatus.FAILED ? (
        <Callout tone="danger" role="status">
          {t('failed')}
        </Callout>
      ) : null}
      {product.extractionTruncated ? <Callout tone="attention">{t('truncated')}</Callout> : null}
      {product.uncertainFields.length > 0 ? (
        <Callout tone="attention" role="note">
          {t('uncertain', {
            fields: product.uncertainFields
              .map((f) => (f in FIELD_KEYS ? t(`fieldNames.${f as keyof typeof FIELD_KEYS}`) : f))
              .join(', '),
          })}
        </Callout>
      ) : null}
      {product.imageKey ? (
        <ProfileImage
          imageKey={product.imageKey}
          width={160}
          height={160}
          className="size-40 rounded-xl object-cover"
        />
      ) : null}
      <form
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm"
        onSubmit={onSubmit}
      >
        <Field
          label={t('fields.title')}
          name="title"
          required
          maxLength={200}
          defaultValue={product.title}
          disabled={pending}
        />
        <Field
          label={t('fields.description')}
          name="description"
          maxLength={2000}
          defaultValue={product.description}
          disabled={pending}
        />
        <Field
          label={t('fields.price')}
          name="price"
          inputMode="decimal"
          defaultValue={priceValue}
          disabled={pending}
        />
        <Field
          label={t('fields.currency')}
          name="currency"
          maxLength={3}
          defaultValue={product.currency}
          disabled={pending}
        />
        <Field
          label={t('fields.merchant')}
          name="merchant"
          maxLength={120}
          defaultValue={product.merchant ?? ''}
          disabled={pending}
        />
        {product.sourceUrl ? (
          <p className="text-sm break-all">
            {t('fields.sourceUrl')} :{' '}
            <a
              href={product.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {product.sourceUrl}
            </a>
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="submit" variant="secondary" disabled={pending || update.isPending}>
            {t('save')}
          </Button>
          {listId ? (
            <Button
              type="button"
              disabled={pending || add.isPending}
              onClick={() => {
                add.mutate(
                  { id: listId, data: { productId: product.id } },
                  {
                    onSuccess: () => {
                      announceMoment('wish-added');
                      router.push(`/lists/${listId}`);
                    },
                    onError,
                  },
                );
              }}
            >
              {t('addToList')}
            </Button>
          ) : null}
        </div>
      </form>
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      <ShareCard product={product} onChanged={refresh} />
      {listId ? (
        <Button asChild variant="ghost" className="self-start">
          <Link href={`/lists/${listId}`}>
            <ChevronRightIcon width={16} height={16} className="rotate-180" />
            {t('backToList')}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

const FIELD_KEYS = {
  title: 1,
  description: 1,
  price: 1,
  currency: 1,
  merchant: 1,
  image: 1,
} as const;

/**
 * REP-02, REP-06, MOD-06, MOD-12 : publier au cercle ou au catalogue ouvert à tous ; une fiche liée
 * à un élément caché exige un choix.
 */
function ShareCard({ product, onChanged }: { product: ProductView; onChanged: () => void }) {
  const t = useTranslations('draft.share');
  const tg = useTranslations('shareGlobal');
  const te = useTranslations('lists.errors');
  const [level, setLevel] = useState<ShareLevel>(ShareLevel.CIRCLE);
  const share = useShareProduct();
  const [choice, setChoice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function publish(target: ShareLevel, hiddenItemChoice?: HiddenItemChoice) {
    setError(null);
    setLevel(target);
    share.mutate(
      {
        id: product.id,
        data: { level: target, ...(hiddenItemChoice ? { hiddenItemChoice } : {}) },
      },
      {
        onSuccess: () => {
          setChoice(false);
          onChanged();
        },
        onError: (e) => {
          if (e instanceof ApiError && e.problem.code === 'HIDDEN_ITEM_REQUIRES_CHOICE')
            setChoice(true);
          else if (
            e instanceof ApiError &&
            (e.problem.code === 'CHILD_PUBLICATION_FORBIDDEN' ||
              e.problem.code === 'PUBLICATION_SUSPENDED')
          )
            setError(tg(e.problem.code));
          else setError(te(listErrorKey(e)));
        },
      },
    );
  }

  const shared = product.shareLevel !== ShareLevel.PRIVATE;
  const status =
    product.shareLevel === ShareLevel.GLOBAL
      ? product.moderationStatus === 'APPROVED'
        ? tg('GLOBAL')
        : tg('PENDING')
      : product.moderationStatus === 'REJECTED'
        ? tg('REJECTED')
        : shared
          ? t('CIRCLE')
          : t('PRIVATE');
  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      <CardDescription className="mt-1">{status}</CardDescription>
      <p className="mt-1 text-sm text-foreground-muted">{tg('who')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {product.shareLevel !== ShareLevel.GLOBAL ? (
          <Button
            variant="secondary"
            disabled={share.isPending}
            onClick={() => {
              publish(ShareLevel.GLOBAL);
            }}
          >
            {tg('publish')}
          </Button>
        ) : null}
        {shared ? (
          <Button
            variant="secondary"
            disabled={share.isPending}
            onClick={() => {
              share.mutate(
                { id: product.id, data: { level: ShareLevel.PRIVATE } },
                {
                  onSuccess: onChanged,
                  onError: (e) => {
                    setError(te(listErrorKey(e)));
                  },
                },
              );
            }}
          >
            {t('unpublish')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            disabled={share.isPending}
            onClick={() => {
              publish(ShareLevel.CIRCLE);
            }}
          >
            {t('publish')}
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Dialog open={choice} onOpenChange={setChoice}>
        <DialogContent>
          <DialogTitle>{t('hiddenTitle')}</DialogTitle>
          <DialogDescription>{t('hiddenBody')}</DialogDescription>
          <div className="mt-4 flex flex-col gap-2">
            <Button
              onClick={() => {
                publish(level, HiddenItemChoice.MAKE_VISIBLE_TO_ALL);
              }}
              disabled={share.isPending}
            >
              {t('makeAll')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setChoice(false);
              }}
            >
              {t('someOnly')}
            </Button>
            <p className="text-sm text-foreground-muted">{t('someOnlyHint')}</p>
            <Button
              variant="ghost"
              onClick={() => {
                setChoice(false);
              }}
            >
              {t('cancel')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
