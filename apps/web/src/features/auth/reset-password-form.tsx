'use client';

import { useConfirmPasswordReset } from '@wishlist/api-client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { authErrorKey, isPasswordError } from './api-errors';
import { text } from './form-data';
import { Field } from './field';
import { FormError } from './form-error';
import { useFragmentToken } from './fragment-token';

export function ResetPasswordForm() {
  const t = useTranslations('auth');
  const token = useFragmentToken();
  const confirm = useConfirmPasswordReset();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);

  if (token === undefined) return null;
  if (token === null) {
    return (
      <p role="alert" className="text-sm text-danger">
        {t('errors.TOKEN_INVALID')}
      </p>
    );
  }

  if (confirm.isSuccess) {
    return (
      <div role="status" className="flex flex-col gap-3">
        <p className="font-medium">{t('reset.done')}</p>
        <p className="text-sm text-foreground-muted">{t('reset.doneHint')}</p>
        <Button asChild>
          <Link href="/auth/login">{t('login.submit')}</Link>
        </Button>
      </div>
    );
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const newPassword = text(new FormData(event.currentTarget), 'password');
    if (newPassword.length < 12 || newPassword.length > 256) {
      setPasswordError(t('errors.PASSWORD_LENGTH'));
      return;
    }
    setPasswordError(undefined);
    setFormError(null);
    confirm.mutate(
      { data: { token: token as string, newPassword } },
      {
        onError: (error) => {
          const message = t(`errors.${authErrorKey(error)}`);
          if (isPasswordError(error)) setPasswordError(message);
          else setFormError(message);
        },
      },
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
        label={t('fields.newPassword')}
        hint={t('register.passwordHint')}
        name="password"
        type="password"
        autoComplete="new-password"
        error={passwordError}
        required
      />
      <FormError message={formError} />
      <Button type="submit" disabled={confirm.isPending}>
        {confirm.isPending ? t('reset.submitting') : t('reset.submit')}
      </Button>
    </form>
  );
}
