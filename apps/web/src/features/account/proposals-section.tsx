'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  getListAccountProfilesQueryKey,
  getListProfileProposalsQueryKey,
  type ProfileProposalView,
  useAcceptProfileProposal,
  useListProfileProposals,
  useRefuseProfileProposal,
} from '@wishlist/api-client';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { authErrorKey } from '@/features/auth/api-errors';
import { FormError } from '@/features/auth/form-error';
import { useReauth } from './reauth';

/** Invitations à créer un profil dans ce compte (PRO-11) : on les accepte ou les refuse ici. */
export function ProposalsSection() {
  const t = useTranslations('proposals');
  const ta = useTranslations('auth');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const reauth = useReauth();
  const { data } = useListProfileProposals();
  const accept = useAcceptProfileProposal();
  const refuse = useRefuseProfileProposal();
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListProfileProposalsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListAccountProfilesQueryKey() });
  };

  function onAccept(proposal: ProfileProposalView) {
    setError(null);
    accept.mutate(
      { id: proposal.id },
      {
        onSuccess: refresh,
        onError: (e) => {
          if (
            !reauth.handleError(e, () => {
              onAccept(proposal);
            })
          ) {
            setError(ta(`errors.${authErrorKey(e)}`));
          }
        },
      },
    );
  }

  if (!data?.items.length) return null;

  return (
    <section aria-labelledby="proposals-title" className="flex flex-col gap-3">
      <h2 id="proposals-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p className="text-sm text-foreground-muted">{t('who')}</p>
      <FormError message={error} />
      <ul className="flex flex-col gap-2">
        {data.items.map((proposal) => (
          <li key={proposal.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <p>
              {t(proposal.profileIsChild ? 'bodyChild' : 'body', { name: proposal.inviterName })}
            </p>
            <p className="text-sm text-foreground-muted">
              {t('expires', {
                date: format.dateTime(new Date(proposal.expiresAt), { dateStyle: 'medium' }),
              })}
            </p>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  onAccept(proposal);
                }}
                disabled={accept.isPending}
              >
                {t('accept')}
              </Button>
              <Button
                variant="secondary"
                disabled={refuse.isPending}
                onClick={() => {
                  refuse.mutate({ id: proposal.id }, { onSuccess: refresh });
                }}
              >
                {t('refuse')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {reauth.dialog}
    </section>
  );
}
