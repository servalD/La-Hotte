'use client';

import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, getGetSessionQueryKey } from '@wishlist/api-client';
import { purgeUserData } from '@/lib/session/purge';
import { MotionConfig } from 'motion/react';
import { ThemeProvider } from 'next-themes';
import { type ReactNode, useState } from 'react';

function makeQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      // OFF-06 : une lecture refusée (`404`, `403`) passe en erreur ; le coffre n'écrit que les
      // lectures réussies, elle en sort donc à l'écriture suivante (`persist.ts`).
      onError: (error) => {
        if (!(error instanceof ApiError)) return;
        // Reste M-c de la phase 1 : session perdue, données effacées, la garde relit la session.
        if (error.status === 401) {
          purgeUserData(client);
          void client.invalidateQueries({ queryKey: getGetSessionQueryKey() });
        }
      },
    }),
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
      // PIN, mots de passe, secret TOTP et codes de secours ne restent pas en mémoire (M1).
      mutations: { gcTime: 0 },
    },
  });
  return client;
}

/**
 * Fournisseurs côté client. Un QueryClient par navigateur et par montage : jamais partagé
 * entre utilisateurs côté serveur (données propres à un profil).
 */
export function Providers({ children, nonce }: { children: ReactNode; nonce: string | undefined }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem nonce={nonce}>
      {/* MOT-04 : Motion suit la préférence système de mouvement réduit. */}
      <MotionConfig reducedMotion="user" nonce={nonce}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
