'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  getGetSessionQueryKey,
  useGetAccount,
  useReauthenticate,
  useStartGoogleReauth,
} from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { type ReactNode, type SyntheticEvent, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { authErrorKey } from '@/features/auth/api-errors';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { FormError } from '@/features/auth/form-error';

export function isReauthRequired(error: unknown): boolean {
  return error instanceof ApiError && error.problem.code === 'REAUTH_REQUIRED';
}

function ReauthForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('reauth');
  const ta = useTranslations('auth');
  const queryClient = useQueryClient();
  const { data: account } = useGetAccount();
  const reauth = useReauthenticate();
  const google = useStartGoogleReauth();
  const [error, setError] = useState<string | null>(null);

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = text(form, 'password');
    const code = text(form, 'code').trim();
    setError(null);
    reauth.mutate(
      { data: { password: password || undefined, code: code || undefined } },
      {
        onSuccess: (status) => {
          queryClient.setQueryData(getGetSessionQueryKey(), status);
          onDone();
        },
        onError: (e) => {
          setError(
            e instanceof ApiError && e.problem.code === 'INVALID_CREDENTIALS'
              ? t('wrong')
              : ta(`errors.${authErrorKey(e)}`),
          );
        },
      },
    );
  }

  function viaGoogle() {
    google.mutate(undefined, {
      onSuccess: (view) => {
        window.location.assign(view.authorizationUrl);
      },
      onError: (e) => {
        setError(ta(`errors.${authErrorKey(e)}`));
      },
    });
  }

  if (!account) return null;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {account.hasPassword ? (
        <Field
          label={ta('fields.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      ) : null}
      {account.totpEnabled ? (
        <Field
          label={t('code')}
          hint={t('codeHint')}
          name="code"
          autoComplete="one-time-code"
          spellCheck={false}
          required
        />
      ) : null}
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        {account.hasPassword ? (
          <Button type="submit" disabled={reauth.isPending}>
            {t('confirm')}
          </Button>
        ) : null}
        {account.googleLinked ? (
          <Button type="button" variant="secondary" onClick={viaGoogle} disabled={google.isPending}>
            {t('viaGoogle')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Ré-authentification (AUTH-14) à la demande : `handleError` reconnaît `REAUTH_REQUIRED`, ouvre la
 * fenêtre, puis rejoue l'action une fois la ré-authentification faite.
 */
export function useReauth(): {
  dialog: ReactNode;
  handleError: (error: unknown, retry: () => void) => boolean;
} {
  const t = useTranslations('reauth');
  const [open, setOpen] = useState(false);
  const retry = useRef<(() => void) | null>(null);

  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription className="mb-4">{t('who')}</DialogDescription>
        {open ? (
          <ReauthForm
            onDone={() => {
              setOpen(false);
              const again = retry.current;
              retry.current = null;
              again?.();
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );

  return {
    dialog,
    handleError(error, again) {
      if (!isReauthRequired(error)) return false;
      retry.current = again;
      setOpen(true);
      return true;
    },
  };
}
