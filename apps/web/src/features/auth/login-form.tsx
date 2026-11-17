'use client';

import { useQueryClient } from '@tanstack/react-query';
import { getGetSessionQueryKey, useSignIn } from '@wishlist/api-client';
import { authSchemas } from '@wishlist/api-client/zod';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { purgeUserData } from '@/lib/session/purge';
import { authErrorKey } from './api-errors';
import { text } from './form-data';
import { Field } from './field';
import { FormError } from './form-error';
import { GoogleButton } from './google-button';

export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const queryClient = useQueryClient();
  const signIn = useSignIn();
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = text(form, 'email').trim();
    const password = text(form, 'password');
    const sharedDevice = form.get('sharedDevice') === 'on';
    const parsed = authSchemas.signInBody.safeParse({ email, password, sharedDevice });
    if (!parsed.success) {
      setFieldErrors({
        email: email.length < 3 ? t('errors.emailRequired') : undefined,
        password: password.length < 1 ? t('errors.passwordRequired') : undefined,
      });
      return;
    }
    setFieldErrors({});
    setFormError(null);
    signIn.mutate(
      { data: parsed.data },
      {
        onSuccess: (status) => {
          // Nouvelle identité : le cache d'un compte précédent ne survit pas à la connexion.
          purgeUserData(queryClient);
          queryClient.setQueryData(getGetSessionQueryKey(), status);
          // AUTH-12 : mot de passe validé, second facteur attendu (écran de la tranche 7b).
          router.replace(status.secondFactorPending ? '/auth/second-factor' : '/');
        },
        onError: (error) => {
          setFormError(t(`errors.${authErrorKey(error)}`));
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
        label={t('fields.email')}
        name="email"
        type="email"
        autoComplete="username"
        error={fieldErrors.email}
        required
      />
      <Field
        label={t('fields.password')}
        name="password"
        type="password"
        autoComplete="current-password"
        error={fieldErrors.password}
        required
      />
      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-3">
          <input
            id="login-shared-device"
            name="sharedDevice"
            type="checkbox"
            className="size-5 shrink-0 self-center"
            aria-describedby="login-shared-device-hint"
          />
          <Label
            htmlFor="login-shared-device"
            className="flex min-h-touch flex-1 items-center font-normal"
          >
            {t('login.sharedDevice')}
          </Label>
        </div>
        <p id="login-shared-device-hint" className="text-sm text-foreground-muted">
          {t('login.sharedDeviceHint')}
        </p>
      </div>
      <FormError message={formError} />
      <Button type="submit" disabled={signIn.isPending}>
        {signIn.isPending ? t('login.submitting') : t('login.submit')}
      </Button>
      <GoogleButton label={t('login.google')} />
    </form>
  );
}
