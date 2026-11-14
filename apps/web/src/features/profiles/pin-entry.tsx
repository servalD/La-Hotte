'use client';

import { ApiError, type ProfileSelectionView } from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { FormError } from '@/features/auth/form-error';

const PIN = /^[0-9]{4,8}$/;

/** Message et attente (PIN-03) d'une erreur de sélection de profil. */
export function pinErrorState(error: unknown): { key: string; wait: number | null } {
  if (error instanceof ApiError) {
    if (error.problem.code === 'PIN_INVALID') return { key: 'PIN_INVALID', wait: null };
    if (error.problem.code === 'PIN_RATE_LIMITED' || error.status === 429) {
      return { key: 'PIN_RATE_LIMITED', wait: error.retryAfter };
    }
    if (error.problem.code === 'PROFILE_NOT_FOUND') return { key: 'PROFILE_NOT_FOUND', wait: null };
    return { key: 'generic', wait: null };
  }
  return { key: 'network', wait: null };
}

/**
 * Saisie du PIN d'un profil (PIN-02, PIN-03). Après 5 erreurs, l'API répond avec une attente
 * (`Retry-After`) : le champ se ferme et un compte à rebours est annoncé.
 */
export function PinEntry({
  profileName,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  profileName: string;
  pending: boolean;
  error: unknown;
  onSubmit: (pin: string) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('pin');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const state = error ? pinErrorState(error) : null;
  const [remaining, setRemaining] = useState<number | null>(null);
  const [seenError, setSeenError] = useState<unknown>(null);
  // Nouvelle erreur : on repart de l'attente annoncée (ajustement d'état pendant le rendu).
  if (error !== seenError) {
    setSeenError(error);
    setRemaining(state?.wait ?? null);
  }

  useEffect(() => {
    if (remaining === null || remaining <= 0) return;
    const id = window.setTimeout(() => {
      setRemaining((value) => (value === null ? null : value - 1));
    }, 1000);
    return () => {
      window.clearTimeout(id);
    };
  }, [remaining]);

  const waiting = remaining !== null && remaining > 0;

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const pin = text(new FormData(event.currentTarget), 'pin');
    if (!PIN.test(pin)) {
      setFieldError(t('format'));
      return;
    }
    setFieldError(undefined);
    onSubmit(pin);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-foreground-muted">{t('who', { name: profileName })}</p>
      <Field
        label={t('label')}
        name="pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        disabled={waiting}
        error={fieldError ?? (state?.key === 'PIN_INVALID' ? t('errors.PIN_INVALID') : undefined)}
      />
      {waiting ? (
        <p role="status" className="text-sm text-foreground">
          {t('wait', { seconds: remaining })}
        </p>
      ) : null}
      <FormError
        message={state && state.key !== 'PIN_INVALID' && !waiting ? t(`errors.${state.key}`) : null}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || waiting}>
          {pending ? t('submitting') : t('submit')}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Ce que le titulaire doit lire avant d'entrer (PIN-03, PIN-05) : PIN réinitialisé ou désactivé
 * depuis l'espace Compte, essais faux depuis la dernière entrée.
 */
export function PinNotice({
  selection,
  onContinue,
}: {
  selection: ProfileSelectionView;
  onContinue: () => void;
}) {
  const t = useTranslations('pin');
  return (
    <div role="alert" className="flex flex-col gap-3">
      <h3 className="font-semibold">{t('notice.title')}</h3>
      {selection.pinResetNoticeAt ? (
        <p>{t('notice.reset', { date: new Date(selection.pinResetNoticeAt).toLocaleString() })}</p>
      ) : null}
      {selection.failedPinAttempts > 0 ? (
        <p>{t('notice.failed', { count: selection.failedPinAttempts })}</p>
      ) : null}
      <p className="text-sm text-foreground-muted">{t('notice.advice')}</p>
      <Button onClick={onContinue}>{t('notice.continue')}</Button>
    </div>
  );
}
