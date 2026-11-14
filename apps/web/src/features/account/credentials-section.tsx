'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAccountQueryKey,
  getGetSessionQueryKey,
  useChangePassword,
  useGetAccount,
  useRequestEmailChange,
  useStartGoogleLink,
  useUnlinkGoogle,
} from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { authErrorKey, isPasswordError } from '@/features/auth/api-errors';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { FormError } from '@/features/auth/form-error';
import { useReauth } from './reauth';

/** E-mail, mot de passe et Google du compte (AUTH-03, AUTH-16) ; ré-authentification AUTH-14. */
export function CredentialsSection() {
  const t = useTranslations('credentials');
  const ta = useTranslations('auth');
  const queryClient = useQueryClient();
  const { data: account } = useGetAccount();
  const reauth = useReauth();
  const changePassword = useChangePassword();
  const changeEmail = useRequestEmailChange();
  const linkGoogle = useStartGoogleLink();
  const unlinkGoogle = useUnlinkGoogle();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [emailError, setEmailError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'password' | 'email' | null>(null);

  if (!account) return null;

  function fail(e: unknown, retry: () => void) {
    if (reauth.handleError(e, retry)) return true;
    setError(ta(`errors.${authErrorKey(e)}`));
    return false;
  }

  function submitPassword(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = event.currentTarget;
    const newPassword = text(new FormData(form), 'password');
    if (newPassword.length < 12 || newPassword.length > 256) {
      setPasswordError(ta('errors.PASSWORD_LENGTH'));
      return;
    }
    setPasswordError(undefined);
    setError(null);
    const run = () => {
      changePassword.mutate(
        { data: { newPassword } },
        {
          onSuccess: (status) => {
            queryClient.setQueryData(getGetSessionQueryKey(), status);
            setDone('password');
            form.reset();
          },
          onError: (e) => {
            if (isPasswordError(e)) setPasswordError(ta(`errors.${authErrorKey(e)}`));
            else fail(e, run);
          },
        },
      );
    };
    run();
  }

  function submitEmail(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = text(new FormData(form), 'email').trim();
    if (!email.includes('@') || email.length > 254) {
      setEmailError(ta('errors.emailInvalid'));
      return;
    }
    setEmailError(undefined);
    setError(null);
    const run = () => {
      changeEmail.mutate(
        { data: { email } },
        {
          onSuccess: () => {
            setDone('email');
            form.reset();
          },
          onError: (e) => {
            fail(e, run);
          },
        },
      );
    };
    run();
  }

  function link() {
    setError(null);
    linkGoogle.mutate(undefined, {
      onSuccess: (view) => {
        window.location.assign(view.authorizationUrl);
      },
      onError: (e) => {
        fail(e, link);
      },
    });
  }

  function unlink() {
    setError(null);
    unlinkGoogle.mutate(undefined, {
      onSuccess: (status) => {
        queryClient.setQueryData(getGetSessionQueryKey(), status);
        void queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey() });
      },
      onError: (e) => {
        fail(e, unlink);
      },
    });
  }

  return (
    <section aria-labelledby="cred-title" className="flex flex-col gap-6">
      <h2 id="cred-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p className="text-sm text-foreground-muted">{t('who')}</p>
      <FormError message={error} />

      <form onSubmit={submitEmail} noValidate className="flex flex-col gap-3">
        <p>
          {t('currentEmail')} <strong>{account.email}</strong>{' '}
          {account.emailVerified ? null : <span>({t('unverified')})</span>}
        </p>
        <Field
          label={t('newEmail')}
          hint={t('emailHint')}
          name="email"
          type="email"
          autoComplete="email"
          error={emailError}
        />
        <Button
          type="submit"
          variant="secondary"
          className="self-start"
          disabled={changeEmail.isPending}
        >
          {t('changeEmail')}
        </Button>
        {done === 'email' ? <p role="status">{t('emailSent')}</p> : null}
      </form>

      <form onSubmit={submitPassword} noValidate className="flex flex-col gap-3">
        <Field
          label={account.hasPassword ? t('newPassword') : t('setPassword')}
          hint={t('passwordHint')}
          name="password"
          type="password"
          autoComplete="new-password"
          error={passwordError}
        />
        <Button
          type="submit"
          variant="secondary"
          className="self-start"
          disabled={changePassword.isPending}
        >
          {account.hasPassword ? t('changePassword') : t('createPassword')}
        </Button>
        {done === 'password' ? <p role="status">{t('passwordChanged')}</p> : null}
      </form>

      <div className="flex flex-col gap-3">
        <h3 className="font-semibold">{t('google.title')}</h3>
        <p className="text-sm text-foreground-muted">
          {account.googleLinked ? t('google.linked') : t('google.notLinked')}
        </p>
        {account.googleLinked ? (
          <Button
            variant="secondary"
            className="self-start"
            onClick={unlink}
            disabled={unlinkGoogle.isPending}
          >
            {t('google.unlink')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            className="self-start"
            onClick={link}
            disabled={linkGoogle.isPending}
          >
            {t('google.link')}
          </Button>
        )}
      </div>
      {reauth.dialog}
    </section>
  );
}
