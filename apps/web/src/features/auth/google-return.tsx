'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  getGetAccountQueryKey,
  getGetSessionQueryKey,
  useReauthenticate,
} from '@wishlist/api-client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { purgeUserData } from '@/lib/session/purge';
import { Label } from '@/components/ui/label';
import { Field } from './field';
import { FormError } from './form-error';
import { GoogleButton } from './google-button';
import { text } from './form-data';

const KNOWN_ERRORS = new Set([
  'GOOGLE_REGISTRATION_REQUIRED',
  'GOOGLE_LINK_REQUIRED',
  'GOOGLE_EMAIL_UNVERIFIED',
  'GOOGLE_EMAIL_UNAVAILABLE',
  'GOOGLE_FLOW_INVALID',
  'GOOGLE_IDENTITY_MISMATCH',
  'GOOGLE_IDENTITY_TAKEN',
  'GOOGLE_ALREADY_LINKED',
  'GOOGLE_NOT_LINKED',
  'GOOGLE_REJECTED',
  'GOOGLE_UNAVAILABLE',
  'INVITATION_REQUIRED',
  'ACCOUNT_SUSPENDED',
  'REAUTH_REQUIRED',
  'TOTP_ENROLLMENT_REQUIRED',
]);

/** Issue d'un retour de Google : `?status=` ou `?error=` (aucun jeton ni valeur de Google). */
export function GoogleReturn() {
  const t = useTranslations('google');
  const ta = useTranslations('auth');
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = params.get('status');
  const error = params.get('error');
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || !status) return;
    handled.current = true;
    void (async () => {
      purgeUserData(queryClient);
      await queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey() });
      if (status === 'signed_in') router.replace('/profiles');
      else if (status === 'second_factor') router.replace('/auth/second-factor');
      else if (status === 'linked' || status === 'reauthenticated') router.replace('/account');
    })();
  }, [status, queryClient, router]);

  if (status === 'reauth_second_factor') return <ReauthCode />;
  if (status) return <p role="status">{t('working')}</p>;

  if (error === 'GOOGLE_REGISTRATION_REQUIRED') return <Registration />;

  const known = error && KNOWN_ERRORS.has(error) ? error : 'generic';
  return (
    <div role="alert" className="flex flex-col gap-3">
      <p>{t(`errors.${known}`)}</p>
      {error === 'GOOGLE_LINK_REQUIRED' ? (
        <Button asChild>
          <Link href="/auth/login">{ta('login.submit')}</Link>
        </Button>
      ) : (
        <Button asChild variant="secondary">
          <Link href="/auth/login">{ta('links.login')}</Link>
        </Button>
      )}
      {error === 'REAUTH_REQUIRED' || error === 'GOOGLE_FLOW_INVALID' ? (
        <p className="text-sm text-foreground-muted">{t('restart')}</p>
      ) : null}
    </div>
  );
}

/** Retour de Google sans compte : l'inscription demande l'âge et le nom avant de repartir. */
function Registration() {
  const t = useTranslations('google');
  const ta = useTranslations('auth');
  const [errors, setErrors] = useState<{ name?: string; age?: string }>({});
  const formRef = useRef<HTMLFormElement>(null);

  function collect() {
    if (!formRef.current) return null;
    const form = new FormData(formRef.current);
    const displayName = text(form, 'displayName').trim();
    const next: typeof errors = {};
    if (displayName.length < 1 || displayName.length > 60)
      next.name = ta('errors.displayNameInvalid');
    if (form.get('ageAttested') !== 'on') next.age = ta('errors.AGE_ATTESTATION_REQUIRED');
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    return {
      displayName,
      ageAttested: true,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  return (
    <form
      ref={formRef}
      onSubmit={(e: SyntheticEvent) => {
        e.preventDefault();
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      <p>{t('registrationNeeded')}</p>
      <Field
        label={ta('fields.displayName')}
        name="displayName"
        maxLength={60}
        error={errors.name}
        required
      />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-3">
          <input
            id="g-age"
            name="ageAttested"
            type="checkbox"
            className="size-5 shrink-0 self-center"
          />
          <Label htmlFor="g-age" className="flex min-h-touch flex-1 items-center font-normal">
            {ta('register.ageAttestation')}
          </Label>
        </div>
        {errors.age ? (
          <p role="alert" className="text-sm text-danger">
            {errors.age}
          </p>
        ) : null}
      </div>
      <GoogleButton label={t('registerWithGoogle')} onInvalid={collect} />
    </form>
  );
}

/** Ré-authentification par Google avec TOTP actif : le code reste à saisir (AUTH-14). */
function ReauthCode() {
  const t = useTranslations('google');
  const ta = useTranslations('auth');
  const router = useRouter();
  const queryClient = useQueryClient();
  const reauth = useReauthenticate();
  const [error, setError] = useState<string | null>(null);

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const code = text(new FormData(event.currentTarget), 'code').trim();
    if (code.length < 6) {
      setError(ta('errors.INVALID_SECOND_FACTOR'));
      return;
    }
    setError(null);
    reauth.mutate(
      { data: { code } },
      {
        onSuccess: (status) => {
          queryClient.setQueryData(getGetSessionQueryKey(), status);
          router.replace('/account');
        },
        onError: (e) => {
          setError(
            e instanceof ApiError && e.problem.code === 'INVALID_SECOND_FACTOR'
              ? ta('errors.INVALID_SECOND_FACTOR')
              : ta('errors.generic'),
          );
        },
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p>{t('codeNeeded')}</p>
      <Field
        label={t('code')}
        name="code"
        autoComplete="one-time-code"
        spellCheck={false}
        required
      />
      <FormError message={error} />
      <Button type="submit" disabled={reauth.isPending}>
        {t('confirm')}
      </Button>
    </form>
  );
}
