'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  getGetOwnTransferQueryKey,
  OwnTransferViewKind,
  TransferConsentDtoPinChoice,
  useConsentOwnTransfer,
  useGetOwnTransfer,
  useRefuseOwnTransfer,
} from '@wishlist/api-client';
import { useFormatter, useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { authErrorKey } from '@/features/auth/api-errors';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { FormError } from '@/features/auth/form-error';

/**
 * Demande de changement de compte visant ce profil (PRO-12, PRO-13) : le profil la voit à chaque
 * entrée, donne ou refuse son accord (PIN validé), et choisit ce que devient son PIN.
 */
export function OwnTransfer() {
  const t = useTranslations('ownTransfer');
  const ta = useTranslations('auth');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const { data } = useGetOwnTransfer();
  const consent = useConsentOwnTransfer();
  const refuse = useRefuseOwnTransfer();
  const [choice, setChoice] = useState<TransferConsentDtoPinChoice>(
    TransferConsentDtoPinChoice.KEEP,
  );
  const [pinError, setPinError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const transfer = data?.transfer;
  if (!transfer) return null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetOwnTransferQueryKey() });
  };

  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const newPin = text(new FormData(event.currentTarget), 'newPin');
    if (choice === TransferConsentDtoPinChoice.NEW && !/^[0-9]{4,8}$/.test(newPin)) {
      setPinError(ta('errors.pinFormat'));
      return;
    }
    setPinError(undefined);
    setError(null);
    consent.mutate(
      {
        data: {
          pinChoice: choice,
          newPin: choice === TransferConsentDtoPinChoice.NEW ? newPin : undefined,
        },
      },
      {
        onSuccess: refresh,
        onError: (e) => {
          setError(ta(`errors.${authErrorKey(e)}`));
        },
      },
    );
  }

  return (
    <section
      aria-labelledby="own-transfer-title"
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <h2 id="own-transfer-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p role="alert">
        {transfer.kind === OwnTransferViewKind.DETACH
          ? t('detach', { email: transfer.newEmail ?? '' })
          : t('move', { names: transfer.destinationNames.join(', ') || t('unknownAccount') })}
      </p>
      {transfer.regroup ? <p>{t('regroup')}</p> : null}
      <p className="text-sm text-foreground-muted">
        {transfer.executesAt
          ? t('executes', { date: when(transfer.executesAt) })
          : t('expires', { date: when(transfer.expiresAt) })}
      </p>
      <p className="text-sm text-foreground-muted">{t('cancelAnytime')}</p>
      <FormError message={error} />

      {transfer.profileConsentRequired && !transfer.profileConsented ? (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{t('pinChoice')}</legend>
            {Object.values(TransferConsentDtoPinChoice).map((value) => (
              <div key={value} className="flex items-start gap-3">
                <input
                  id={`ot-${value}`}
                  type="radio"
                  className="size-5 shrink-0 self-center"
                  checked={choice === value}
                  onChange={() => {
                    setChoice(value);
                  }}
                />
                <Label
                  htmlFor={`ot-${value}`}
                  className="flex min-h-touch flex-1 items-center font-normal"
                >
                  {t(`pin.${value}`)}
                </Label>
              </div>
            ))}
          </fieldset>
          {choice === TransferConsentDtoPinChoice.NONE ? (
            <p role="note" className="rounded-md border border-border p-3 text-sm">
              {t('noneWarning')}
            </p>
          ) : null}
          {choice === TransferConsentDtoPinChoice.NEW ? (
            <Field
              label={t('newPin')}
              name="newPin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              error={pinError}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={consent.isPending}>
              {t('consent')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={refuse.isPending}
              onClick={() => {
                refuse.mutate(undefined, { onSuccess: refresh });
              }}
            >
              {t('refuse')}
            </Button>
          </div>
        </form>
      ) : transfer.profileConsented ? (
        <div className="flex flex-col gap-2">
          <p role="status">{t('consented')}</p>
          <Button
            variant="secondary"
            className="self-start"
            disabled={refuse.isPending}
            onClick={() => {
              refuse.mutate(undefined, { onSuccess: refresh });
            }}
          >
            {t('cancel')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
