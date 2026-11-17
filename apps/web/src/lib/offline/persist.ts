import {
  dehydrate,
  type DehydratedState,
  hydrate,
  type Query,
  type QueryClient,
} from '@tanstack/react-query';
import { ApiError } from '@wishlist/api-client';
import { CACHE_RETENTION_MS } from './device';
import type { ProfileVault } from './vault';

/**
 * OFF-06 : liste fermée des lectures écrites dans le coffre du profil, par le chemin de la clé de
 * requête générée (`[url, params?]`). Tout le reste (session, compte, profil actif, cercle,
 * justificatif) ne vit qu'en mémoire.
 */
const PERSISTED = [
  /^\/api\/v1\/lists(\/[0-9a-f-]{36}(\/(items|members))?)?$/,
  /^\/api\/v1\/items\/[0-9a-f-]{36}(\/(accounting|threads|comments|visibility))?$/,
  /^\/api\/v1\/products(\/[0-9a-f-]{36})?$/,
  /^\/api\/v1\/events(\/[0-9a-f-]{36}(\/(participants|progress))?)?$/,
  /^\/api\/v1\/(cart|balances|budgets|offset-proposals|accounting\/overview)$/,
  /^\/api\/v1\/notifications(\/unread-count)?$/,
];

export function isPersisted(queryKey: readonly unknown[]): boolean {
  const path = queryKey[0];
  return typeof path === 'string' && PERSISTED.some((pattern) => pattern.test(path));
}

/**
 * Une lecture réussie, ou dont la relecture a échoué faute de réseau (la donnée d'avant reste
 * bonne à garder). Une lecture que l'API refuse (`ApiError`) sort du coffre (OFF-06).
 */
const shouldPersist = (query: Query) =>
  query.state.data !== undefined &&
  isPersisted(query.queryKey) &&
  (query.state.status === 'success' ||
    (query.state.status === 'error' && !(query.state.error instanceof ApiError)));

interface Snapshot {
  readonly savedAt: number;
  readonly state: DehydratedState;
}

const SNAPSHOT = 'state';

export function snapshotOf(queryClient: QueryClient, now: number): Snapshot {
  const state = dehydrate(queryClient, {
    shouldDehydrateQuery: shouldPersist,
    shouldDehydrateMutation: () => false,
  });
  return {
    savedAt: now,
    state: {
      mutations: [],
      // Seule la donnée compte : une erreur de réseau n'est pas un état à relire.
      queries: state.queries.map((q) => ({
        ...q,
        state: {
          ...q.state,
          status: 'success' as const,
          error: null,
          errorUpdatedAt: 0,
          fetchFailureCount: 0,
          fetchFailureReason: null,
          fetchStatus: 'idle' as const,
        },
      })),
    },
  };
}

/** Relit le coffre ; une lecture de plus de 30 jours est ignorée (OFF-07). */
export async function restoreQueries(
  queryClient: QueryClient,
  vault: ProfileVault,
  now: number,
  /**
   * OFF-20 : vérifié juste avant d'écrire dans le cache de l'onglet. Un changement de profil
   * pendant la lecture du coffre annule la restauration : les lectures d'un profil ne sont jamais
   * versées sous un autre (les clés de requête ne portent pas le profil).
   */
  isCurrent: () => boolean = () => true,
): Promise<number> {
  const snapshot = await vault.read<Snapshot>('cache', SNAPSHOT);
  if (!snapshot || !isCurrent()) return 0;
  const queries = snapshot.state.queries.filter(
    (q) => isPersisted(q.queryKey) && now - q.state.dataUpdatedAt <= CACHE_RETENTION_MS,
  );
  hydrate(queryClient, { mutations: [], queries });
  return queries.length;
}

/** Une session perdue (`401`) efface les lectures, pas la file (OFF-29). */
export function forgetQueries(vault: ProfileVault): Promise<void> {
  return vault.remove('cache', SNAPSHOT);
}

/**
 * Écrit l'état des lectures persistées au plus une fois par seconde après un changement ; une
 * lecture retirée du cache (purge, `access.revoked`) disparaît donc du coffre à l'écriture
 * suivante. Rend la fonction d'arrêt, qui écrit une dernière fois sauf avec `discard`.
 */
export function persistQueries(
  queryClient: QueryClient,
  vault: ProfileVault,
  options: {
    delayMs?: number;
    now?: () => number;
    /** Faux : le cache de l'onglet n'est plus celui du profil de ce coffre ; rien n'est écrit. */
    isOwner?: () => boolean;
  } = {},
): (options?: { discard?: boolean }) => Promise<void> {
  const delay = options.delayMs ?? 1_000;
  const now = options.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();
  let stopped = false;

  const flush = () => {
    timer = null;
    if (options.isOwner && !options.isOwner()) return;
    const snapshot = snapshotOf(queryClient, now());
    writing = writing.then(() => vault.write('cache', SNAPSHOT, snapshot)).catch(() => undefined);
  };

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (stopped) return;
    if (event.type !== 'updated' && event.type !== 'removed' && event.type !== 'added') return;
    if (!isPersisted(event.query.queryKey as readonly unknown[])) return;
    timer ??= setTimeout(flush, delay);
  });
  // Ce qui était déjà lu à l'ouverture du coffre (lectures du profil faites avant) est écrit aussi.
  timer = setTimeout(flush, delay);

  return async ({ discard = false } = {}) => {
    stopped = true;
    unsubscribe();
    if (timer) {
      clearTimeout(timer);
      timer = null;
      // `discard` : l'identité vient de changer, l'état courant du cache n'est plus celui du
      // profil de ce coffre (OFF-20) ; rien n'est écrit.
      if (!discard) flush();
    }
    await writing;
  };
}
