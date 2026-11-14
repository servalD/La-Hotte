'use client';

import { type GoogleRegistrationDto, useRegisterAccount } from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { authErrorKey, isPasswordError } from './api-errors';
import { text } from './form-data';
import { Field } from './field';
import { FormError } from './form-error';
import { useFragmentToken } from './fragment-token';
import { GoogleButton } from './google-button';

type Errors = Partial<Record<'email' | 'password' | 'displayName' | 'age', string>>;

const LOCALE = /^[a-z]{2}(-[A-Z]{2})?$/;

export function RegisterForm() {
  const t = useTranslations('auth');
  const register = useRegisterAccount();
  const formRef = useRef<HTMLFormElement>(null);
  // LNK-08, AUTH-09 : le jeton d'invitation arrive dans le fragment (/auth/register#<jeton>).
  const fragment = useFragmentToken();
  const invitationToken = fragment?.length === 22 ? fragment : undefined;
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = text(form, 'email').trim();
    const password = text(form, 'password');
    const displayName = text(form, 'displayName').trim();
    const ageAttested = form.get('ageAttested') === 'on';
    const locale = LOCALE.test(navigator.language) ? navigator.language : undefined;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const next: Errors = {};
    if (!email.includes('@') || email.length > 254) next.email = t('errors.emailInvalid');
    if (password.length < 12 || password.length > 256) next.password = t('errors.PASSWORD_LENGTH');
    if (displayName.length < 1 || displayName.length > 60) {
      next.displayName = t('errors.displayNameInvalid');
    }
    if (!ageAttested) next.age = t('errors.AGE_ATTESTATION_REQUIRED');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setFormError(null);
    register.mutate(
      {
        data: {
          email,
          password,
          displayName,
          ageAttested: true,
          locale,
          timezone,
          invitationToken,
        },
      },
      {
        // Réponse identique que l'adresse soit déjà connue ou non (énumération impossible).
        onSuccess: () => {
          setSentTo(email);
        },
        onError: (error) => {
          const message = t(`errors.${authErrorKey(error)}`);
          if (isPasswordError(error)) setErrors({ password: message });
          else setFormError(message);
        },
      },
    );
  }

  function collectGoogle(): GoogleRegistrationDto | null {
    if (!formRef.current) return null;
    const form = new FormData(formRef.current);
    const displayName = text(form, 'displayName').trim();
    const next: Errors = {};
    if (displayName.length < 1 || displayName.length > 60)
      next.displayName = t('errors.displayNameInvalid');
    if (form.get('ageAttested') !== 'on') next.age = t('errors.AGE_ATTESTATION_REQUIRED');
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    return {
      displayName,
      ageAttested: true,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      invitationToken,
    };
  }

  if (sentTo) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <p className="font-medium">{t('register.sentTitle')}</p>
        <p className="text-sm text-foreground-muted">{t('register.sentBody', { email: sentTo })}</p>
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
        error={errors.email}
        required
      />
      <Field
        label={t('fields.newPassword')}
        hint={t('register.passwordHint')}
        name="password"
        type="password"
        autoComplete="new-password"
        error={errors.password}
        required
      />
      <Field
        label={t('fields.displayName')}
        hint={t('register.displayNameHint')}
        name="displayName"
        autoComplete="nickname"
        maxLength={60}
        error={errors.displayName}
        required
      />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-3">
          <input
            id="age"
            name="ageAttested"
            type="checkbox"
            className="size-5 shrink-0 self-center"
            aria-invalid={errors.age ? true : undefined}
            aria-describedby={errors.age ? 'age-error' : undefined}
          />
          <Label htmlFor="age" className="flex min-h-touch flex-1 items-center font-normal">
            {t('register.ageAttestation')}
          </Label>
        </div>
        {errors.age ? (
          <p id="age-error" role="alert" className="text-sm text-danger">
            {errors.age}
          </p>
        ) : null}
      </div>
      <FormError message={formError} />
      <Button type="submit" disabled={register.isPending}>
        {register.isPending ? t('register.submitting') : t('register.submit')}
      </Button>
      <GoogleButton label={t('register.google')} onInvalid={collectGoogle} />
    </form>
  );
}
