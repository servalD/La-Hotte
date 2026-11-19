'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  getListAccountProfilesQueryKey,
  getListIncomingTransfersQueryKey,
  type TransferPreviewView,
  useAcceptTransfer,
  useInspectTransfer,
  useListIncomingTransfers,
  useWithdrawTransferAcceptance,
} from '@wishlist/api-client';
import { useFormatter, useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { authErrorKey } from '@/features/auth/api-errors';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { FormError } from '@/features/auth/form-error';
import { ProfileAvatar } from '@/features/profiles/profile-avatar';
import { useReauth } from './reauth';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Recevoir un profil d'un autre compte (PRO-12) : on ouvre le jeton reçu, on voit qui arrive, puis
 * on accepte après ré-authentification. Le refus est commun : on ne dit pas pourquoi (TRANSFER_INVALID).
 */
export function IncomingTransfers() {
  const t = useTranslations('incoming');
  const ta = useTranslations('auth');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const reauth = useReauth();
  const list = useListIncomingTransfers();
  const inspect = useInspectTransfer();
  const accept = useAcceptTransfer();
  const withdraw = useWithdrawTransferAcceptance();
  const [preview, setPreview] = useState<{ token: string; view: TransferPreviewView } | null>(null);
  const [tokenError, setTokenError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListIncomingTransfersQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListAccountProfilesQueryKey() });
  };

  function open(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const token = text(new FormData(event.currentTarget), 'token').trim();
    if (!TOKEN.test(token)) {
      setTokenError(t('tokenInvalid'));
      return;
    }
    setTokenError(undefined);
    setError(null);
    inspect.mutate(
      { data: { token } },
      {
        onSuccess: (view) => {
          setPreview({ token, view });
        },
        onError: () => {
          setTokenError(t('refused'));
        },
      },
    );
  }

  function confirm() {
    if (!preview) return;
    setError(null);
    const run = () => {
      accept.mutate(
        { data: { token: preview.token } },
        {
          onSuccess: () => {
            setPreview(null);
            refresh();
          },
          onError: (e) => {
            if (reauth.handleError(e, run)) return;
            setError(ta(`errors.${authErrorKey(e)}`));
          },
        },
      );
    };
    run();
  }

  return (
    <section aria-labelledby="incoming-title" className="flex flex-col gap-3">
      <h2 id="incoming-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p className="text-sm text-foreground-muted">{t('who')}</p>

      {preview ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center gap-3">
            <ProfileAvatar
              name={preview.view.profileName}
              color={preview.view.accentColor}
              size={40}
            />
            <p className="font-medium">{preview.view.profileName}</p>
          </div>
          <p>{t(preview.view.isChild ? 'previewChild' : 'preview')}</p>
          <p role="note" className="text-sm text-foreground-muted">
            {t('pinWarning')}
          </p>
          <FormError message={error} />
          <div className="flex gap-2">
            <Button onClick={confirm} disabled={accept.isPending}>
              {t('accept')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPreview(null);
              }}
            >
              {t('cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={open} noValidate className="flex flex-col gap-3">
          <Field
            label={t('token')}
            hint={t('tokenHint')}
            name="token"
            autoComplete="off"
            spellCheck={false}
            error={tokenError}
          />
          <Button
            type="submit"
            variant="secondary"
            className="self-start"
            disabled={inspect.isPending}
          >
            {t('open')}
          </Button>
        </form>
      )}

      <ul className="flex flex-col gap-2">
        {list.data?.items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4"
          >
            <div className="flex items-center gap-3">
              <ProfileAvatar name={item.profileName} color={item.accentColor} size={40} />
              <div>
                <p className="font-medium">{item.profileName}</p>
                <p className="text-sm text-foreground-muted">
                  {item.executesAt
                    ? t('executes', {
                        date: format.dateTime(new Date(item.executesAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }),
                      })
                    : t('waitingProfile')}
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              disabled={withdraw.isPending}
              onClick={() => {
                withdraw.mutate({ id: item.id }, { onSuccess: refresh });
              }}
            >
              {t('withdraw')}
            </Button>
          </li>
        ))}
      </ul>
      {reauth.dialog}
    </section>
  );
}
