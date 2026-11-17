'use client';

import { useCallback, useMemo, useState } from 'react';

function newKey(): string {
  return crypto.randomUUID();
}

/**
 * CPT-51, CPT-71 : une clé par intention de l'utilisateur. Un double clic ou un nouvel essai après
 * une coupure renvoie la même clé (l'API n'agit qu'une fois) ; la clé change après un succès.
 */
export function useIdempotencyKey() {
  const [key, setKey] = useState(newKey);
  const renew = useCallback(() => {
    setKey(newKey());
  }, []);
  const request = useMemo(() => ({ headers: { 'Idempotency-Key': key } }), [key]);
  return { key, renew, request };
}
