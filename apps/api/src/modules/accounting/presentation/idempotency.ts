import { createHash } from 'node:crypto';
import type { IdempotencyInput } from '../application/contract';
import { IdempotencyKeyRequiredError } from '../application/contract';

/** CPT-71 : une clé est une chaîne courte et sans espace (UUID conseillé côté client). */
const KEY = /^[A-Za-z0-9_-]{8,128}$/;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/**
 * CPT-71, API-16 : clé lue dans l'en-tête `Idempotency-Key`, empreinte de la requête (opération,
 * ressource, corps canonique). La même clé avec une autre empreinte est refusée (`409`).
 */
export function idempotencyOf(
  profileId: string,
  key: string | undefined,
  operation: string,
  resourceId: string,
  body: unknown,
): IdempotencyInput {
  if (key === undefined || !KEY.test(key)) throw new IdempotencyKeyRequiredError();
  const requestHash = createHash('sha256')
    .update(JSON.stringify([operation, resourceId, canonical(body ?? null)]))
    .digest('hex');
  return { profileId, key, requestHash };
}
