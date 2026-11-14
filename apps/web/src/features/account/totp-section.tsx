'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAccountQueryKey,
  getGetSessionQueryKey,
  type TotpEnrollmentView,
  useActivateTotp,
  useDisableTotp,
  useGetAccount,
  useRegenerateRecoveryCodes,
  useStartTotpEnrollment,
} from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { QrCode } from '@/components/qr-code';
import { Button } from '@/components/ui/button';
import { authErrorKey } from '@/features/auth/api-errors';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { FormError } from '@/features/auth/form-error';
import { RecoveryCodes } from './recovery-codes';
import { useReauth } from './reauth';

/**
 * TOTP (AUTH-11, AUTH-13) : activation par le secret affiché (le QR code dessiné par le client), codes de secours montrés une fois, régénération, désactivation.
 * Les actions sensibles passent par la ré-authentification (AUTH-14).
 */
export function TotpSection() {
  const t = useTranslations('totp');
  const ta = useTranslations('auth');
  const queryClient = useQueryClient();
  const { data: account } = useGetAccount();
  const reauth = useReauth();
  const start = useStartTotpEnrollment();
  const activate = useActivateTotp();
  const regenerate = useRegenerateRecoveryCodes();
  const disable = useDisableTotp();
  const [enrollment, setEnrollment] = useState<TotpEnrollmentView | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | undefined>();

  if (!account) return null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey() });
  };
  const fail = (e: unknown, retry: () => void) => {
    if (reauth.handleError(e, retry)) return;
    setError(ta(`errors.${authErrorKey(e)}`));
  };

  function begin() {
    setError(null);
    start.mutate(undefined, {
      onSuccess: setEnrollment,
      onError: (e) => {
        fail(e, begin);
      },
    });
  }

  function confirm(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const code = text(new FormData(event.currentTarget), 'code').trim();
    if (!/^\d{6}$/.test(code)) {
      setCodeError(t('codeFormat'));
      return;
    }
    setCodeError(undefined);
    setError(null);
    activate.mutate(
      { data: { code } },
      {
        onSuccess: (view) => {
          setEnrollment(null);
          setCodes(view.recoveryCodes);
          queryClient.setQueryData(getGetSessionQueryKey(), {
            authenticated: view.authenticated,
            csrfToken: view.csrfToken,
            session: view.session,
            secondFactorPending: view.secondFactorPending,
          });
          refresh();
        },
        onError: (e) => {
          setCodeError(
            e instanceof Error && e.message === 'INVALID_SECOND_FACTOR'
              ? t('wrongCode')
              : ta(`errors.${authErrorKey(e)}`),
          );
        },
      },
    );
  }

  function renew() {
    setError(null);
    regenerate.mutate(undefined, {
      onSuccess: (view) => {
        setCodes(view.recoveryCodes);
        refresh();
      },
      onError: (e) => {
        fail(e, renew);
      },
    });
  }

  function turnOff() {
    setError(null);
    disable.mutate(undefined, {
      onSuccess: (status) => {
        queryClient.setQueryData(getGetSessionQueryKey(), status);
        refresh();
      },
      onError: (e) => {
        fail(e, turnOff);
      },
    });
  }

  return (
    <section aria-labelledby="totp-title" className="flex flex-col gap-3">
      <h2 id="totp-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p className="text-sm text-foreground-muted">{t('who')}</p>
      <FormError message={error} />

      {codes ? (
        <RecoveryCodes
          codes={codes}
          onDone={() => {
            setCodes(null);
            // Secret et codes de secours ne restent pas dans l'état des mutations (M1).
            start.reset();
            activate.reset();
            regenerate.reset();
          }}
        />
      ) : enrollment ? (
        <form onSubmit={confirm} noValidate className="flex flex-col gap-3">
          <p>{t('enroll.step1')}</p>
          <QrCode value={enrollment.otpauthUri} label={t('enroll.qrLabel')} />
          <p className="text-sm text-foreground-muted">{t('enroll.orKey')}</p>
          <p className="font-mono text-lg break-all" aria-label={t('enroll.secretLabel')}>
            {enrollment.secret}
          </p>
          <p className="text-sm text-foreground-muted">{t('enroll.manual')}</p>
          <Field
            label={t('enroll.codeLabel')}
            hint={t('enroll.codeHint')}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            error={codeError}
            required
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={activate.isPending}>
              {t('enroll.activate')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEnrollment(null);
              }}
            >
              {t('enroll.cancel')}
            </Button>
          </div>
        </form>
      ) : account.totpEnabled ? (
        <div className="flex flex-col gap-3">
          <p role="status">{t('enabled', { count: account.recoveryCodesRemaining })}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={renew} disabled={regenerate.isPending}>
              {t('regenerate')}
            </Button>
            <Button variant="danger" onClick={turnOff} disabled={disable.isPending}>
              {t('disable')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p>{t('disabled')}</p>
          <Button className="self-start" onClick={begin} disabled={start.isPending}>
            {t('enable')}
          </Button>
        </div>
      )}
      {reauth.dialog}
    </section>
  );
}
