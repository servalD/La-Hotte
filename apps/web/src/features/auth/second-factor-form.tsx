'use client';

import { useQueryClient } from '@tanstack/react-query';
import { getGetSessionQueryKey, useVerifySecondFactor } from '@wishlist/api-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { purgeUserData } from '@/lib/session/purge';
import { Label } from '@/components/ui/label';
import { ApiError } from '@wishlist/api-client';
import { authErrorKey } from './api-errors';
import { Field } from './field';
import { FormError } from './form-error';
import { text } from './form-data';

const CODE = /^[0-9A-Za-z -]{6,32}$/;

/** Second facteur à la connexion (AUTH-12) : code de l'application, ou code de secours. */
export function SecondFactorForm() {
  const t = useTranslations('secondFactor');
  const ta = useTranslations('auth');
  const router = useRouter();
  const queryClient = useQueryClient();
  const verify = useVerifySecondFactor();
  const [codeError, setCodeError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = text(form, 'code').trim();
    if (!CODE.test(code)) {
      setCodeError(t('codeInvalid'));
      return;
    }
    setCodeError(undefined);
    setFormError(null);
    verify.mutate(
      { data: { code, trustDevice: form.get('trustDevice') === 'on' } },
      {
        onSuccess: (status) => {
          purgeUserData(queryClient);
          queryClient.setQueryData(getGetSessionQueryKey(), status);
          router.replace('/profiles');
        },
        onError: (error) => {
          if (error instanceof ApiError && error.problem.code === 'SECOND_FACTOR_EXPIRED') {
            setExpired(true);
          } else if (error instanceof ApiError && error.problem.code === 'INVALID_SECOND_FACTOR') {
            setCodeError(t('wrongCode'));
          } else {
            setFormError(ta(`errors.${authErrorKey(error)}`));
          }
        },
      },
    );
  }

  if (expired) {
    return (
      <div role="alert" className="flex flex-col gap-3">
        <p>{t('expired')}</p>
        <Button asChild>
          <Link href="/auth/login">{ta('links.login')}</Link>
        </Button>
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
        label={t('code')}
        hint={t('codeHint')}
        name="code"
        inputMode="text"
        autoComplete="one-time-code"
        autoCapitalize="none"
        spellCheck={false}
        error={codeError}
        required
      />
      <div className="flex items-start gap-3">
        <input
          id="trust"
          name="trustDevice"
          type="checkbox"
          className="size-5 shrink-0 self-center"
        />
        <Label htmlFor="trust" className="flex min-h-touch flex-1 items-center font-normal">
          {t('trustDevice')}
        </Label>
      </div>
      <FormError message={formError} />
      <Button type="submit" disabled={verify.isPending}>
        {verify.isPending ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
