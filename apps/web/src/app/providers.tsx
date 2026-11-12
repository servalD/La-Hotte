'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { ThemeProvider } from 'next-themes';
import { type ReactNode, useState } from 'react';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
    },
  });
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
