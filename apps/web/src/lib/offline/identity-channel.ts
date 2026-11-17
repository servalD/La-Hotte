// OFF-29 (reste M-b de la phase 1) : un changement d'identité dans un onglet (autre profil,
// verrouillage, déconnexion) purge les autres onglets de l'application sur l'appareil.

const CHANNEL = 'lh-identity';

export interface IdentityMessage {
  /** Identité nouvelle (`identityKey`), ou `null` après une déconnexion. */
  readonly identity: string | null;
}

function channel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
}

export function announceIdentity(identity: string | null): void {
  const ch = channel();
  if (!ch) return;
  ch.postMessage({ identity } satisfies IdentityMessage);
  ch.close();
}

export function listenIdentity(listener: (message: IdentityMessage) => void): () => void {
  const ch = channel();
  if (!ch) return () => undefined;
  ch.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data as Partial<IdentityMessage> | null;
    if (data && (typeof data.identity === 'string' || data.identity === null)) {
      listener({ identity: data.identity });
    }
  };
  return () => {
    ch.close();
  };
}
