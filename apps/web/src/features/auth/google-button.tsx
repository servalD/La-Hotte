'use client';

import { type GoogleRegistrationDto, useStartGoogleSignIn } from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { authErrorKey } from './api-errors';
import { FormError } from './form-error';

/**
 * Départ de la connexion ou de l'inscription par Google (AUTH-01). Le navigateur est envoyé chez
 * Google par une navigation (jamais par `fetch`) ; le retour atterrit sur `/auth/google/return`.
 * Portées `openid email` seules : ni nom ni photo ne sont demandés à Google.
 */
export function GoogleButton({
  label,
  registration,
  onInvalid,
}: {
  label: string;
  registration?: GoogleRegistrationDto;
  /** Pour l'inscription : l'âge et le nom doivent être saisis avant le départ (AUTH-08). */
  onInvalid?: () => GoogleRegistrationDto | null;
}) {
  const t = useTranslations('auth');
  const start = useStartGoogleSignIn();
  const [error, setError] = useState<string | null>(null);

  function go() {
    const body = onInvalid ? onInvalid() : (registration ?? null);
    if (onInvalid && !body) return;
    setError(null);
    start.mutate(
      { data: body ? { registration: body } : {} },
      {
        onSuccess: (view) => {
          window.location.assign(view.authorizationUrl);
        },
        onError: (e) => {
          setError(t(`errors.${authErrorKey(e)}`));
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="secondary" onClick={go} disabled={start.isPending}>
        {label}
      </Button>
      <FormError message={error} />
    </div>
  );
}
