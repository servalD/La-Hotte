'use client';

import { useGetSession } from '@wishlist/api-client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { nextRoute, type Requirement } from './next-route';

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
