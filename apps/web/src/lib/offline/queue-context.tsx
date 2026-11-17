'use client';

import { type QueryClient } from '@tanstack/react-query';
import { apiFetch } from '@wishlist/api-client';
import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import {
  type ActionQueue,
  type QueuedAction,
  type QueuedInput,
  type QueuedStep,
  type StepSender,
} from './queue';

/**
 * Envoi d'une étape par le mutateur du client généré (ADR 0020) : CSRF, `X-User-Activity` et
 * erreurs RFC 9457 comme pour toute mutation. La clé d'idempotence est celle de l'étape.
 */
export const sendStep: StepSender = (step: QueuedStep, body) =>
  apiFetch<unknown>(step.url, {
    method: step.method,
    headers: {
      'Idempotency-Key': step.key,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(step.ifMatch ? { 'If-Match': step.ifMatch } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

/** Lectures à relire quand une action est acceptée (le serveur reste seul juge, OFF-12). */
export function refreshAfter(queryClient: QueryClient, action: QueuedAction): void {
  const ids = [action.subject.itemId, action.subject.listId].filter(
    (id): id is string => typeof id === 'string',
  );
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const key = JSON.stringify(query.queryKey);
      return (
        ids.some((id) => key.includes(id)) ||
        (action.kind.startsWith('contribution') ||
        action.kind.startsWith('purchase') ||
        action.kind.startsWith('settlement')
          ? /cart|balances|accounting\/overview/.test(key)
          : false)
      );
    },
  });
}

interface QueueContextValue {
  readonly queue: ActionQueue | null;
  readonly online: boolean;
}

export const QueueContext = createContext<QueueContextValue>({ queue: null, online: true });

const EMPTY: readonly QueuedAction[] = [];

/** Actions de la file du profil, à jour. */
export function useQueuedActions(): readonly QueuedAction[] {
  const { queue } = useContext(QueueContext);
  return useSyncExternalStore(
    (listener) => queue?.subscribe(listener) ?? (() => undefined),
    () => queue?.snapshot() ?? EMPTY,
    () => EMPTY,
  );
}

/** Actions en attente qui touchent un élément (affichage « à confirmer », UX-32, OFF-13). */
export function usePendingFor(itemId: string): readonly QueuedAction[] {
  const actions = useQueuedActions();
  return actions.filter((a) => a.subject.itemId === itemId && a.state === 'pending');
}

/**
 * Faire un geste qui peut se mettre en file (OFF-17) : envoyé tout de suite en ligne, mis en file
 * sans réseau. Un refus de l'API en ligne est levé comme d'habitude (affichage par champ).
 */
export function useOfflineAction(): (
  input: QueuedInput,
) => Promise<{ queued: true } | { queued: false; result: unknown }> {
  const { queue, online } = useContext(QueueContext);
  return useCallback(
    async (input: QueuedInput) => {
      if (queue) return queue.perform(input, online);
      // File pas encore prête : envoi direct, sans file.
      const results: unknown[] = [];
      for (const step of input.steps) {
        const previous = results[results.length - 1] as { id?: unknown } | undefined;
        const body =
          step.productIdFromPrevious && typeof previous?.id === 'string'
            ? { ...step.body, productId: previous.id }
            : step.body;
        results.push(await sendStep({ ...step, key: crypto.randomUUID() }, body));
      }
      return { queued: false as const, result: results[results.length - 1] };
    },
    [queue, online],
  );
}

export function useActionQueue(): ActionQueue | null {
  return useContext(QueueContext).queue;
}
