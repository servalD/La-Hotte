'use client';

import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { ApiError, getGetSessionQueryKey, useGetSession } from '@wishlist/api-client';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { identityKey } from '@/features/session/next-route';
import { purgeUserData } from '@/lib/session/purge';
import { announceIdentity, listenIdentity } from './identity-channel';
import {
  forgetLastProfileReads,
  type OpenProfileCache,
  openOffline,
  openOnline,
} from './profile-cache';
import type { ProfileVault } from './vault';

/**
 * - `online` : session lue, coffre du profil ouvert (ou pas de coffre : appareil partagé) ;
 * - `offline` : pas de réseau au lancement, coffre du dernier profil rouvert (OFF-27) ;
 * - `needs_network` : pas de réseau, et le dernier profil a un PIN (OFF-21) ;
 * - `starting` : décision en cours.
 */
export type OfflineMode = 'starting' | 'online' | 'offline' | 'needs_network';

interface OfflineState {
  readonly mode: OfflineMode;
  /** Profil dont le coffre est ouvert ; `null` sans coffre. */
  readonly profileId: string | null;
  readonly vault: ProfileVault | null;
  /** OFF-30 : rien n'est écrit sur l'appareil. */
  readonly sharedDevice: boolean;
}

const OfflineContext = createContext<OfflineState>({
  mode: 'online',
  profileId: null,
  vault: null,
  sharedDevice: false,
});

export function useOffline(): OfflineState {
  return useContext(OfflineContext);
}

export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (listener) => onlineManager.subscribe(listener),
    () => onlineManager.isOnline(),
    () => true,
  );
}

/** Erreur de transport (pas de réponse de l'API), à distinguer d'un refus de l'API. */
function isNetworkFailure(error: unknown): boolean {
  return error !== null && error !== undefined && !(error instanceof ApiError);
}

/**
 * Cache cloisonné par profil (OFF-20 à OFF-30, ADR 0020). Suit l'identité de la session : à
 * chaque changement, le coffre précédent est fermé avant que le suivant ne s'ouvre, et les autres
 * onglets sont prévenus. Hors ligne au lancement, rouvre le dernier profil si c'est permis.
 */
export function OfflineProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const online = useIsOnline();
  const { data, error } = useGetSession({ query: { staleTime: 0 } });
  const [state, setState] = useState<OfflineState>({
    mode: 'starting',
    profileId: null,
    vault: null,
    sharedDevice: false,
  });
  const current = useRef<OpenProfileCache | null>(null);
  const identity = data ? identityKey(data) : null;
  const lastIdentity = useRef<string | null>(null);

  const session = data?.authenticated ? data.session : null;
  const profileId = session?.profileUnlocked ? session.activeProfileId : null;
  const accountTag = session?.accountTag ?? null;
  const shared = session?.sharedDevice ?? false;
  const unreachable = !data && (!online || isNetworkFailure(error));

  // Autres onglets : une identité différente de la nôtre purge tout et relit la session.
  useEffect(
    () =>
      listenIdentity((message) => {
        if (message.identity === lastIdentity.current) return;
        purgeUserData(queryClient);
        void queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
      }),
    [queryClient],
  );

  useEffect(() => {
    if (identity === null) return;
    if (lastIdentity.current !== null && lastIdentity.current !== identity) {
      announceIdentity(identity);
    }
    lastIdentity.current = identity;
  }, [identity]);

  useEffect(() => {
    let cancelled = false;
    const previous = current.current;
    current.current = null;

    const settle = (next: OfflineState, opened: OpenProfileCache | null) => {
      if (cancelled) {
        void opened?.close();
        return;
      }
      current.current = opened;
      setState(next);
    };

    const run = async () => {
      // Fermé d'abord, de façon synchrone pour l'écriture : rien du profil suivant n'y entre.
      await previous?.close();
      if (data && !data.authenticated) {
        await forgetLastProfileReads().catch(() => undefined);
        settle({ mode: 'online', profileId: null, vault: null, sharedDevice: false }, null);
        return;
      }
      if (profileId && accountTag && !shared) {
        const opened = await openOnline({
          queryClient,
          accountTag,
          profileId,
          now: Date.now(),
          isCurrent: () => !cancelled,
        }).catch(() => null);
        settle(
          { mode: 'online', profileId, vault: opened?.vault ?? null, sharedDevice: false },
          opened,
        );
        return;
      }
      if (session) {
        settle({ mode: 'online', profileId: null, vault: null, sharedDevice: shared }, null);
        return;
      }
      if (unreachable) {
        const opening = await openOffline({
          queryClient,
          now: Date.now(),
          isCurrent: () => !cancelled,
        }).catch(() => ({ kind: 'nothing' }) as const);
        if (opening.kind === 'opened') {
          settle(
            {
              mode: 'offline',
              profileId: opening.cache.profileId,
              vault: opening.cache.vault,
              sharedDevice: false,
            },
            opening.cache,
          );
        } else {
          settle(
            {
              mode: opening.kind === 'needs_network' ? 'needs_network' : 'offline',
              profileId: null,
              vault: null,
              sharedDevice: false,
            },
            null,
          );
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // `session` et `data` changent avec l'identité ; seuls ces critères décident d'un coffre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, accountTag, shared, unreachable, data?.authenticated, queryClient]);

  // Fermeture du composant (changement de zone) : le coffre est rendu.
  useEffect(
    () => () => {
      void current.current?.close();
      current.current = null;
    },
    [],
  );

  return <OfflineContext.Provider value={state}>{children}</OfflineContext.Provider>;
}
