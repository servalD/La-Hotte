'use client';

import { useConsentTransferByEmail } from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { authErrorKey } from './api-errors';
import { Field } from './field';
import { FormError } from './form-error';
import { text } from './form-data';
import { useFragmentToken } from './fragment-token';

const CHOICES = ['KEEP', 'NEW', 'NONE'] as const;

/**
 * Accord d'un profil à son passage ou son détachement (PRO-12, PRO-13), donné par le lien reçu à
 * l'adresse du profil. Le PIN : garder, en fixer un, ou n'en avoir aucun (choix explicite, PIN-06).
 */
export function TransferConsentForm() {
  const t = useTranslations('transfers');
  const ta = useTranslations('auth');
  const token = useFragmentToken();
  const consent = useConsentTransferByEmail();
  const [choice, setChoice] = useState<(typeof CHOICES)[number]>('KEEP');
  const [pinError, setPinError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);

  if (token === undefined) return null;
  if (token === null) {
    return (
      <p role="alert" className="text-sm text-danger">
        {ta('errors.TOKEN_INVALID')}
      </p>
    );
  }
  if (consent.isSuccess) {
    return (
      <p role="status" className="font-medium">
        {t('consent.done')}
      </p>
    );
  }

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const newPin = text(new FormData(event.currentTarget), 'newPin');
    if (choice === 'NEW' && !/^[0-9]{4,8}$/.test(newPin)) {
      setPinError(ta('errors.pinFormat'));
      return;
    }
    setPinError(undefined);
    setFormError(null);
    consent.mutate(
      {
        data: {
          token: token as string,
          pinChoice: choice,
          newPin: choice === 'NEW' ? newPin : undefined,
        },
      },
      {
        onError: (e) => {
          setFormError(ta(`errors.${authErrorKey(e)}`));
        },
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-labelledby="auth-title">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t('consent.pinChoice')}</legend>
        {CHOICES.map((value) => (
          <div key={value} className="flex items-start gap-3">
            <input
              id={`pin-${value}`}
              type="radio"
              name="pinChoice"
              className="size-5 shrink-0 self-center"
              checked={choice === value}
              onChange={() => {
                setChoice(value);
              }}
            />
            <Label
              htmlFor={`pin-${value}`}
              className="flex min-h-touch flex-1 items-center font-normal"
            >
              {t(`consent.choices.${value}`)}
            </Label>
          </div>
        ))}
      </fieldset>
      {choice === 'NONE' ? (
        <p role="note" className="rounded-xl border border-border bg-surface p-4 text-sm">
          {t('consent.noneWarning')}
        </p>
      ) : null}
      {choice === 'NEW' ? (
        <Field
          label={t('consent.newPin')}
          name="newPin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          error={pinError}
        />
      ) : null}
      <FormError message={formError} />
      <Button type="submit" disabled={consent.isPending}>
        {t('consent.submit')}
      </Button>
    </form>
  );
}
