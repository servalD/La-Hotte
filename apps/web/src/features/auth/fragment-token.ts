'use client';

import { useSyncExternalStore } from 'react';

// Jeton de 43 caractères (compte), ou de 22 (invitation) : l'API valide la forme exacte.
const TOKEN = /^(?:[A-Za-z0-9_-]{43}|[A-Za-z0-9_-]{22})$/;

let captured: { path: string; raw: string; token: string | null } | undefined;

/**
 * Lit le fragment, puis l'efface de la barre d'adresse et de l'historique. Un fragment vide (déjà
 * effacé) garde le jeton capturé sur cette page ; un nouveau fragment, ou une autre page, le remplace.
 */
function read(): string | null {
  const path = window.location.pathname;
  const raw = window.location.hash.replace(/^#/, '');
  if (captured?.path !== path || (raw && captured.raw !== raw)) {
    captured = { path, raw, token: TOKEN.test(raw) ? raw : null };
    if (raw) window.history.replaceState(null, '', path);
  }
  return captured.token;
}

const subscribe = () => () => undefined;
const serverSnapshot = (): undefined => undefined;

/**
 * Jeton à usage unique du fragment (`#<jeton>`). Le fragment ne part jamais au serveur ni dans un
 * `Referer` (page en no-referrer). `undefined` au rendu serveur, `null` si le fragment n'est pas
 * un jeton.
 */
export function useFragmentToken(): string | null | undefined {
  return useSyncExternalStore(subscribe, read, serverSnapshot);
}
