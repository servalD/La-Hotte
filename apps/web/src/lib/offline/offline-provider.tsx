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
import { ActionQueue } from './queue';
import { QueueContext, refreshAfter, sendStep } from './queue-context';
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

  // File d'actions du profil (OFF-11) : dans son coffre, ou en mémoire sur un appareil partagé.
  const queueOwner =
    state.profileId ?? (state.mode === 'online' && shared && profileId ? profileId : null);
  const [loaded, setLoaded] = useState<{
    owner: string;
    vault: ProfileVault | null;
    queue: ActionQueue;
  } | null>(null);
  // Une file n'est servie que pour son profil et son coffre : jamais celle d'un autre profil.
  const queue =
    loaded && loaded.owner === queueOwner && loaded.vault === state.vault ? loaded.queue : null;
  useEffect(() => {
    if (!queueOwner) return undefined;
    let alive = true;
    const vault = state.vault;
    const next = new ActionQueue(queueOwner, vault, sendStep, (action) => {
      refreshAfter(queryClient, action);
    });
    void next
      .load()
      .catch(() => undefined)
      .then(() => {
        if (alive) setLoaded({ owner: queueOwner, vault, queue: next });
      });
    return () => {
      alive = false;
    };
  }, [queueOwner, state.vault, queryClient]);

  // OFF-16 : rejouée à l'ouverture, au retour du réseau, au retour sur l'onglet, et toutes les
  // 30 secondes ; seulement en ligne, sous la session du profil qui a fait les actions.
  const canReplay = online && state.mode === 'online' && queue?.profileId === profileId;
  useEffect(() => {
    if (!queue || !canReplay) return undefined;
    const kick = () => {
      void queue.run();
    };
    kick();
    const timer = setInterval(kick, 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') kick();
    };
    document.addEventListener('visibilitychange', onVisible);
    // PWA-07 : la synchronisation en arrière-plan du service worker réveille la file.
    const onMessage = (event: MessageEvent<unknown>) => {
      if ((event.data as { type?: unknown } | null)?.type === 'lh-replay-queue') kick();
    };
    const worker = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    worker?.addEventListener('message', onMessage);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      worker?.removeEventListener('message', onMessage);
    };
  }, [queue, canReplay]);

  // OFF-30 : sur un appareil partagé, fermer l'onglet perd la file ; l'application avertit.
  const actions = useSyncExternalStore(
    (listener) => queue?.subscribe(listener) ?? (() => undefined),
    () => queue?.snapshot().length ?? 0,
    () => 0,
  );
  useEffect(() => {
    if (!state.sharedDevice && state.vault) return undefined;
    if (actions === 0) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [actions, state.sharedDevice, state.vault]);

  return (
    <OfflineContext.Provider value={state}>
      <QueueContext.Provider value={{ queue, online }}>{children}</QueueContext.Provider>
    </OfflineContext.Provider>
  );
}
