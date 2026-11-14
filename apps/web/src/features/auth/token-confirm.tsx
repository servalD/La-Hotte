'use client';

import {
  useCancelEmailChange,
  useCancelTransferByEmail,
  useVerifyEmail,
  useVerifyProfileEmail,
} from '@wishlist/api-client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { authErrorKey } from './api-errors';
import { useFragmentToken } from './fragment-token';
import { FormError } from './form-error';

type Kind = 'verifyEmail' | 'cancelEmailChange' | 'verifyProfileEmail' | 'cancelTransfer';

/**
 * Page à jeton unique dans le fragment : un bouton confirme (pas d'appel à l'ouverture, un
 * aperçu de lien ne consomme rien), puis le résultat est annoncé.
 */
export function TokenConfirm({ kind }: { kind: Kind }) {
  const t = useTranslations(`auth.${kind}`);
  const ta = useTranslations('auth');
  const token = useFragmentToken();
  const verify = useVerifyEmail();
  const cancel = useCancelEmailChange();
  const verifyProfile = useVerifyProfileEmail();
  const cancelTransfer = useCancelTransferByEmail();
  const mutation = {
    verifyEmail: verify,
    cancelEmailChange: cancel,
    verifyProfileEmail: verifyProfile,
    cancelTransfer,
  }[kind];
  const [error, setError] = useState<string | null>(null);

  if (token === undefined) return null;

  if (token === null) {
    return (
      <p role="alert" className="text-sm text-danger">
        {ta('errors.TOKEN_INVALID')}
      </p>
    );
  }

  if (mutation.isSuccess) {
    return (
      <div role="status" className="flex flex-col gap-3">
        <p className="font-medium">{t('done')}</p>
        {kind === 'cancelEmailChange' || kind === 'cancelTransfer' ? (
          <p className="text-sm text-foreground-muted">{t('doneHint')}</p>
        ) : null}
        <Button asChild>
          <Link href="/auth/login">{ta('login.submit')}</Link>
        </Button>
      </div>
    );
  }

  function confirm() {
    if (!token) return;
    setError(null);
    mutation.mutate(
      { data: { token } },
      {
        onError: (e) => {
          setError(ta(`errors.${authErrorKey(e)}`));
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <Button onClick={confirm} disabled={mutation.isPending}>
        {mutation.isPending ? t('confirming') : t('confirm')}
      </Button>
      {kind === 'verifyEmail' ? (
        <p className="text-sm text-foreground-muted">
          {t('notYou')}{' '}
          <Link href="/auth/forgot-password" className="underline">
            {t('notYouLink')}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
