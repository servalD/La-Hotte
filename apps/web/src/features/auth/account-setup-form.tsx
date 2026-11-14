'use client';

import { useSetupAccount } from '@wishlist/api-client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { authErrorKey, isPasswordError } from './api-errors';
import { Field } from './field';
import { FormError } from './form-error';
import { text } from './form-data';
import { useFragmentToken } from './fragment-token';

/**
 * Installation d'un compte détaché ou sous tutelle (PRO-13, PRO-15) : le lien reçu par e-mail
 * donne le droit de choisir un mot de passe. Un compte détaché atteste son âge (AUTH-08).
 */
export function AccountSetupForm() {
  const t = useTranslations('setup');
  const ta = useTranslations('auth');
  const token = useFragmentToken();
  const setup = useSetupAccount();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [ageError, setAgeError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);

  if (token === undefined) return null;
  if (token === null) {
    return (
      <p role="alert" className="text-sm text-danger">
        {ta('errors.TOKEN_INVALID')}
      </p>
    );
  }

  if (setup.isSuccess) {
    return (
      <div role="status" className="flex flex-col gap-3">
        <p className="font-medium">{t('done')}</p>
        <Button asChild>
          <Link href="/auth/login">{ta('login.submit')}</Link>
        </Button>
      </div>
    );
  }

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = text(form, 'password');
    const ageAttested = form.get('ageAttested') === 'on';
    let invalid = false;
    if (password.length < 12 || password.length > 256) {
      setPasswordError(ta('errors.PASSWORD_LENGTH'));
      invalid = true;
    } else setPasswordError(undefined);
    if (!ageAttested) {
      setAgeError(ta('errors.AGE_ATTESTATION_REQUIRED'));
      invalid = true;
    } else setAgeError(undefined);
    if (invalid) return;
    setFormError(null);
    setup.mutate(
      { data: { token: token as string, password, ageAttested: true } },
      {
        onError: (e) => {
          const message = ta(`errors.${authErrorKey(e)}`);
          if (isPasswordError(e)) setPasswordError(message);
          else setFormError(message);
        },
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-labelledby="auth-title">
      <Field
        label={ta('fields.newPassword')}
        hint={ta('register.passwordHint')}
        name="password"
        type="password"
        autoComplete="new-password"
        error={passwordError}
        required
      />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-3">
          <input
            id="age"
            name="ageAttested"
            type="checkbox"
            className="size-5 shrink-0 self-center"
          />
          <Label htmlFor="age" className="flex min-h-touch flex-1 items-center font-normal">
            {ta('register.ageAttestation')}
          </Label>
        </div>
        {ageError ? (
          <p role="alert" className="text-sm text-danger">
            {ageError}
          </p>
        ) : null}
      </div>
      <FormError message={formError} />
      <Button type="submit" disabled={setup.isPending}>
        {t('submit')}
      </Button>
    </form>
  );
}
