'use client';

import { useAttestAge } from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { authErrorKey } from '@/features/auth/api-errors';
import { FormError } from '@/features/auth/form-error';

/**
 * Fin de tutelle (PRO-16, AUTH-08) : quand le tuteur a demandé la levée, le compte déclare son âge
 * pour devenir autonome. Sans demande du tuteur, l'API répond `WARD_RELEASE_NOT_REQUESTED`.
 */
export function AgeAttestation() {
  const t = useTranslations('release');
  const ta = useTranslations('auth');
  const attest = useAttestAge();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (attest.isSuccess) return <p role="status">{t('done')}</p>;

  return (
    <section aria-labelledby="release-title" className="flex flex-col gap-3">
      <h2 id="release-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p className="text-sm text-foreground-muted">{t('who')}</p>
      <div className="flex items-start gap-3">
        <input
          id="release-age"
          type="checkbox"
          className="size-5 shrink-0 self-center"
          checked={checked}
          onChange={(e) => {
            setChecked(e.target.checked);
          }}
        />
        <Label htmlFor="release-age" className="flex min-h-touch flex-1 items-center font-normal">
          {ta('register.ageAttestation')}
        </Label>
      </div>
      <FormError message={error} />
      <Button
        variant="secondary"
        className="self-start"
        disabled={!checked || attest.isPending}
        onClick={() => {
          setError(null);
          attest.mutate(
            { data: { ageAttested: true } },
            {
              onError: (e) => {
                setError(ta(`errors.${authErrorKey(e)}`));
              },
            },
          );
        }}
      >
        {t('submit')}
      </Button>
    </section>
  );
}
