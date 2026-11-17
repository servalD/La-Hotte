import { ApiError } from '@wishlist/api-client';
import type { ProfileVault } from './vault';

/**
 * File d'actions hors ligne (OFF-10 à OFF-19, ADR 0020). Une action porte ses étapes (méthode,
 * URL générée, corps, `If-Match`) et une clé d'idempotence par étape, née avec l'intention : un
 * nouvel essai, même après un rechargement, ne fait jamais agir deux fois (API-16).
 */

/** OFF-17 : seuls ces gestes se mettent en file. */
export const QUEUED_KINDS = [
  'comment.post',
  'item.add',
  'item.update',
  'item.delete',
  'item.received',
  'item.unreceived',
  'contribution.put',
  'contribution.delete',
  'purchase.put',
  'settlement.put',
  'settlement.claim',
] as const;
export type QueuedKind = (typeof QUEUED_KINDS)[number];

/** Clé de traduction d'un genre d'action (next-intl n'accepte pas de point dans une clé). */
export const kindKey = (kind: QueuedKind): string => kind.replace('.', '_');

export interface QueuedStep {
  readonly method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly url: string;
  readonly body?: Record<string, unknown>;
  readonly ifMatch?: string;
  readonly key: string;
  /** Étape composée : `productId` pris dans la réponse de l'étape précédente (`id`). */
  readonly productIdFromPrevious?: boolean;
}

/**
 * - `pending` : à envoyer (ou en attente d'un nouvel essai) ;
 * - `refused` : l'API a refusé (droit perdu, ressource supprimée, règle) — OFF-15 ;
 * - `conflict` : version dépassée (`412`) — OFF-14 ;
 * - `expired` : plus de 30 jours en file, plus rejouée (OFF-19).
 */
export type QueuedState = 'pending' | 'refused' | 'conflict' | 'expired';

export interface QueuedOutcome {
  readonly status: number;
  readonly code: string;
  /** CPT-03, OFF-13 : reste actualisé rendu avec `CONTRIBUTION_EXCEEDS_REMAINING`. */
  readonly remainingMinor?: number;
}

export interface QueuedAction {
  readonly id: string;
  readonly kind: QueuedKind;
  readonly profileId: string;
  readonly createdAt: number;
  readonly steps: readonly QueuedStep[];
  /** Étapes déjà acceptées, et leurs réponses (une action composée reprend où elle en était). */
  readonly done: number;
  readonly results: readonly unknown[];
  /** Ce que l'action touche, pour l'afficher « à confirmer » au bon endroit. */
  readonly subject: {
    readonly listId?: string;
    readonly itemId?: string;
    readonly thread?: string;
  };
  /** Ce qui s'affiche de l'action (texte, titre, montant) ; chiffré avec le reste du coffre. */
  readonly display: Readonly<Record<string, string | number | boolean | null>>;
  readonly state: QueuedState;
  readonly attempts: number;
  readonly nextAttemptAt: number;
  readonly outcome?: QueuedOutcome;
}

export type QueuedInput = Pick<QueuedAction, 'kind' | 'subject' | 'display'> & {
  readonly steps: readonly Omit<QueuedStep, 'key'>[];
};

/** OFF-19 : la clé d'idempotence vaut 30 jours côté serveur. */
export const QUEUE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const BACKOFF_MIN_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;

export function backoff(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, attempts - 1));
}

/** Ce que fait une réponse d'erreur à la file (OFF-18). */
export type Verdict = 'refused' | 'conflict' | 'wait_unlock' | 'stop' | 'retry';

export function verdictOf(error: unknown): Verdict {
  if (!(error instanceof ApiError)) return 'retry';
  const status = error.status;
  if (status === 412) return 'conflict';
  if (status === 423) return 'wait_unlock';
  if (status === 401) return 'stop';
  if (status === 429 || status >= 500) return 'retry';
  return 'refused';
}

function outcomeOf(error: ApiError): QueuedOutcome {
  const remaining = (error.problem as { remainingMinor?: unknown }).remainingMinor;
  return {
    status: error.status,
    code: error.problem.code,
    ...(typeof remaining === 'number' ? { remainingMinor: remaining } : {}),
  };
}

/** Envoi d'une étape ; rend le corps de la réponse ou lève (ApiError, ou erreur de transport). */
export type StepSender = (
  step: QueuedStep,
  body: Record<string, unknown> | undefined,
) => Promise<unknown>;

function bodyOf(
  step: QueuedStep,
  results: readonly unknown[],
): Record<string, unknown> | undefined {
  if (!step.productIdFromPrevious) return step.body;
  const previous = results[results.length - 1] as { id?: unknown } | undefined;
  return { ...step.body, productId: typeof previous?.id === 'string' ? previous.id : undefined };
}

const STORE = 'queue';

export class ActionQueue {
  private readonly actions = new Map<string, QueuedAction>();
  private readonly listeners = new Set<() => void>();
  private list: readonly QueuedAction[] = [];
  private running: Promise<void> | null = null;

  constructor(
    readonly profileId: string,
    /** `null` : appareil partagé (OFF-30), la file reste en mémoire. */
    private readonly vault: ProfileVault | null,
    private readonly send: StepSender,
    private readonly onAccepted: (action: QueuedAction) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<void> {
    if (!this.vault) return;
    for (const row of await this.vault.entries(STORE)) {
      const action = row.value as QueuedAction;
      // Jamais rejouée sous un autre profil que le sien (OFF-18).
      if (action.profileId === this.profileId) this.actions.set(action.id, action);
    }
    this.changed();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): readonly QueuedAction[] {
    return this.list;
  }

  /** Envoie tout de suite si possible ; sinon met en file (rend `queued`). */
  async perform(
    input: QueuedInput,
    online: boolean,
  ): Promise<{ queued: true } | { queued: false; result: unknown }> {
    const action = this.create(input);
    if (!online) {
      await this.save(action);
      return { queued: true };
    }
    const results: unknown[] = [];
    try {
      for (const step of action.steps) {
        results.push(await this.send(step, bodyOf(step, results)));
      }
      return { queued: false, result: results[results.length - 1] };
    } catch (error) {
      // Pas de réponse : l'action part en file avec ses clés, et reprend où elle en était.
      if (verdictOf(error) === 'retry' && !(error instanceof ApiError)) {
        await this.save({ ...action, done: results.length, results });
        return { queued: true };
      }
      throw error;
    }
  }

  /** Abandonner (écran des actions non synchronisées). */
  async discard(id: string): Promise<void> {
    this.actions.delete(id);
    await this.vault?.remove(STORE, id);
    this.changed();
  }

  /** « Refaire » (OFF-15) : nouvelle intention, nouvelles clés, éventuellement d'autres étapes. */
  async redo(id: string, replace?: QueuedInput): Promise<void> {
    const old = this.actions.get(id);
    if (!old) return;
    await this.discard(id);
    await this.save(
      this.create(
        replace ?? { kind: old.kind, subject: old.subject, display: old.display, steps: old.steps },
      ),
    );
  }

  /** OFF-12, OFF-16 : rejoue dans l'ordre ; une action en attente arrête les suivantes. */
  run(): Promise<void> {
    this.running ??= this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drain(): Promise<void> {
    const ordered = [...this.actions.values()]
      .filter((a) => a.state === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const action of ordered) {
      const now = this.now();
      if (now - action.createdAt > QUEUE_MAX_AGE_MS) {
        await this.save({ ...action, state: 'expired' });
        continue;
      }
      if (action.nextAttemptAt > now) return;
      const results = [...action.results];
      let done = action.done;
      try {
        for (const step of action.steps.slice(done)) {
          results.push(await this.send(step, bodyOf(step, results)));
          done += 1;
          await this.save({ ...action, done, results });
        }
      } catch (error) {
        const verdict = verdictOf(error);
        const current = { ...action, done, results };
        if (verdict === 'refused' || verdict === 'conflict') {
          await this.save({
            ...current,
            state: verdict,
            ...(error instanceof ApiError ? { outcome: outcomeOf(error) } : {}),
          });
          continue;
        }
        if (verdict === 'retry') {
          await this.save({
            ...current,
            attempts: action.attempts + 1,
            nextAttemptAt: now + backoff(action.attempts + 1),
          });
        }
        // `retry`, `wait_unlock`, `stop` : l'ordre est gardé, les suivantes attendent.
        return;
      }
      this.actions.delete(action.id);
      await this.vault?.remove(STORE, action.id);
      this.changed();
      this.onAccepted({ ...action, done, results });
    }
  }

  private create(input: QueuedInput): QueuedAction {
    return {
      id: crypto.randomUUID(),
      kind: input.kind,
      profileId: this.profileId,
      createdAt: this.now(),
      steps: input.steps.map((step) => ({ ...step, key: crypto.randomUUID() })),
      done: 0,
      results: [],
      subject: input.subject,
      display: input.display,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
    };
  }

  private async save(action: QueuedAction): Promise<void> {
    this.actions.set(action.id, action);
    this.changed();
    await this.vault?.write(STORE, action.id, action);
  }

  private changed(): void {
    this.list = [...this.actions.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const listener of this.listeners) listener();
  }
}
