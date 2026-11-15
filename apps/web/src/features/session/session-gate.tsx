'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useGetSession } from '@wishlist/api-client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { purgeUserData } from '@/lib/session/purge';
import { identityKey, nextRoute, type Requirement } from './next-route';

// Dernière identité vue, partagée entre les mises en page `(app)` et `(account)`.
let lastIdentity: string | null = null;

/**
 * Garde d'écran : suit l'état de session rendu par l'API et redirige. Ce n'est pas une règle
 * d'accès (le serveur refuse de toute façon) : elle évite d'afficher un écran vide.
 */
export function SessionGate({
  requires,
  children,
}: {
  requires: Requirement;
  children: ReactNode;
}) {
  const t = useTranslations('session');
  const router = useRouter();
  const { data, isPending, isError } = useGetSession({ query: { staleTime: 0 } });
  const target = data ? nextRoute(data, requires) : null;
  const queryClient = useQueryClient();

  // Filet de sécurité : quelle que soit la cause (session expirée, autre onglet, verrouillage), un
  // changement d'identité efface les données de l'ancienne (OFF-20, PIN-02).
  const key = data ? identityKey(data) : null;
  useEffect(() => {
    if (key === null) return;
    if (lastIdentity !== null && lastIdentity !== key) purgeUserData(queryClient);
    lastIdentity = key;
  }, [key, queryClient]);

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (isError) {
    return (
      <p role="alert" className="p-6 text-danger">
        {t('unreachable')}
      </p>
    );
  }
  if (isPending || target) {
    return (
      <div className="p-6" role="status" aria-label={t('loading')}>
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }
  return <>{children}</>;
}
