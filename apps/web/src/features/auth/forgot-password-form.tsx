'use client';

import { useRequestPasswordReset } from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { authErrorKey } from './api-errors';
import { text } from './form-data';
import { Field } from './field';
import { FormError } from './form-error';

export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const request = useRequestPasswordReset();
  const [emailError, setEmailError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const email = text(new FormData(event.currentTarget), 'email').trim();
    if (!email.includes('@') || email.length > 254) {
      setEmailError(t('errors.emailInvalid'));
      return;
    }
    setEmailError(undefined);
    setFormError(null);
    request.mutate(
      { data: { email } },
      {
        onError: (error) => {
          setFormError(t(`errors.${authErrorKey(error)}`));
        },
      },
    );
  }

  // Même réponse que l'adresse existe ou non (AUTH-06).
  if (request.isSuccess) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <p className="font-medium">{t('forgot.sentTitle')}</p>
        <p className="text-sm text-foreground-muted">{t('forgot.sentBody')}</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
      aria-labelledby="auth-title"
    >
      <Field
        label={t('fields.email')}
        name="email"
        type="email"
        autoComplete="email"
        error={emailError}
        required
      />
      <FormError message={formError} />
      <Button type="submit" disabled={request.isPending}>
        {request.isPending ? t('forgot.submitting') : t('forgot.submit')}
      </Button>
    </form>
  );
}
