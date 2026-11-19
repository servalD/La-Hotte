'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  getGetOwnProfileQueryKey,
  useClearOwnEmail,
  useGetOwnProfile,
  useReadChildNotice,
  useSetOwnEmail,
  useSetOwnPin,
} from '@wishlist/api-client';
import { useFormatter, useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { authErrorKey } from '@/features/auth/api-errors';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { FormError } from '@/features/auth/form-error';

const PIN = /^[0-9]{4,8}$/;

/** PIN du profil (PIN-04), adresse du profil (PRO-10), notices à lire (PIN-05, PRO-09). */
export function PinEmailSection() {
  const t = useTranslations('settings');
  const ta = useTranslations('auth');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const { data: profile } = useGetOwnProfile();
  const setPin = useSetOwnPin();
  const setEmail = useSetOwnEmail();
  const clearEmail = useClearOwnEmail();
  const readNotice = useReadChildNotice();
  const [pinError, setPinError] = useState<string | undefined>();
  const [emailError, setEmailError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'pin' | 'email' | null>(null);

  if (!profile) return null;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetOwnProfileQueryKey() });
  };

  function submitPin(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const newPin = text(data, 'newPin');
    const currentPin = text(data, 'currentPin');
    if (!PIN.test(newPin)) {
      setPinError(ta('errors.pinFormat'));
      return;
    }
    setPinError(undefined);
    setError(null);
    setPin.mutate(
      { data: { newPin, currentPin: currentPin || undefined } },
      {
        onSuccess: () => {
          form.reset();
          setDone('pin');
          refresh();
        },
        onError: (e) => {
          const key = authErrorKey(e);
          if (
            key === 'PIN_INVALID' ||
            key === 'CURRENT_PIN_REQUIRED' ||
            key === 'PIN_RATE_LIMITED'
          ) {
            setPinError(ta(`errors.${key}`));
          } else setError(ta(`errors.${key}`));
        },
      },
    );
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
    setEmail.mutate(
      { data: { email } },
      {
        onSuccess: () => {
          form.reset();
          setDone('email');
        },
        onError: (e) => {
          setError(ta(`errors.${authErrorKey(e)}`));
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {profile.pinResetNoticeAt ? (
        <div role="alert" className="rounded-xl border border-border bg-surface p-4">
          <p className="font-medium">
            {t('notices.pinReset', {
              date: format.dateTime(new Date(profile.pinResetNoticeAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}
          </p>
          <p className="text-sm text-foreground-muted">{t('notices.pinResetAdvice')}</p>
        </div>
      ) : null}
      {profile.childNoticeAt ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4"
        >
          <p className="font-medium">{t('notices.child')}</p>
          <Button
            variant="secondary"
            className="self-start"
            disabled={readNotice.isPending}
            onClick={() => {
              readNotice.mutate(undefined, { onSuccess: refresh });
            }}
          >
            {t('notices.read')}
          </Button>
        </div>
      ) : null}
      <FormError message={error} />

      <form
        onSubmit={submitPin}
        noValidate
        className="flex flex-col gap-3"
        aria-labelledby="pin-title"
      >
        <h2 id="pin-title" className="text-lg font-semibold">
          {t('pin.title')}
        </h2>
        <p className="text-sm text-foreground-muted">{t('pin.who')}</p>
        {profile.hasPin ? (
          <Field
            label={t('pin.current')}
            name="currentPin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
          />
        ) : null}
        <Field
          label={t('pin.new')}
          hint={t('pin.hint')}
          name="newPin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          error={pinError}
        />
        <Button
          type="submit"
          variant="secondary"
          className="self-start"
          disabled={setPin.isPending}
        >
          {profile.hasPin ? t('pin.change') : t('pin.set')}
        </Button>
        {done === 'pin' ? <p role="status">{t('pin.done')}</p> : null}
      </form>

      {profile.isChild ? null : (
        <form
          onSubmit={submitEmail}
          noValidate
          className="flex flex-col gap-3"
          aria-labelledby="email-title"
        >
          <h2 id="email-title" className="text-lg font-semibold">
            {t('email.title')}
          </h2>
          <p className="text-sm text-foreground-muted">{t('email.who')}</p>
          {profile.email ? <p>{t('email.current', { email: profile.email })}</p> : null}
          <Field
            label={t('email.label')}
            name="email"
            type="email"
            autoComplete="email"
            error={emailError}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" disabled={setEmail.isPending}>
              {t('email.set')}
            </Button>
            {profile.email ? (
              <Button
                type="button"
                variant="ghost"
                disabled={clearEmail.isPending}
                onClick={() => {
                  clearEmail.mutate(undefined, { onSuccess: refresh });
                }}
              >
                {t('email.clear')}
              </Button>
            ) : null}
          </div>
          {done === 'email' ? <p role="status">{t('email.sent')}</p> : null}
        </form>
      )}
    </div>
  );
}
