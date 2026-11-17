'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ApiError, useDeleteAccount } from '@wishlist/api-client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { wipeDevice } from '@/lib/offline/device';
import { announceIdentity } from '@/lib/offline/identity-channel';
import { forgetProfileKeys } from '@/lib/offline/keys';
import { useReauth } from './reauth';

const KNOWN = new Set(['HAS_WARDS', 'LAST_ADMIN']);

/**
 * RGPD-05, RGPD-12 : suppression du compte dans 30 jours, après ré-authentification. Toutes les
 * sessions tombent : l'appareil est vidé comme à une déconnexion (OFF-22).
 */
export function AccountDeletionSection() {
  const t = useTranslations('accountDeletion');
  const router = useRouter();
  const queryClient = useQueryClient();
  const reauth = useReauth();
  const remove = useDeleteAccount();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setError(null);
    remove.mutate(undefined, {
      onSuccess: () => {
        forgetProfileKeys();
        queryClient.clear();
        announceIdentity(null);
        void wipeDevice().finally(() => {
          router.replace('/auth/login');
        });
      },
      onError: (e) => {
        if (reauth.handleError(e, confirm)) return;
        const code = e instanceof ApiError ? e.problem.code : '';
        setError(t(KNOWN.has(code) ? code : 'generic'));
      },
    });
  }

  return (
    <section aria-labelledby="account-deletion-title" className="flex flex-col gap-3">
      <h2 id="account-deletion-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p className="text-sm text-foreground-muted">{t('who')}</p>
      <div>
        <ConfirmButton
          label={t('button')}
          title={t('confirmTitle')}
          description={t('confirmBody')}
          confirmLabel={t('confirm')}
          cancelLabel={t('cancel')}
          onConfirm={confirm}
          disabled={remove.isPending}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {reauth.dialog}
    </section>
  );
}
