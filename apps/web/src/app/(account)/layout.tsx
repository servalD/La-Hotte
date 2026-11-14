import type { ReactNode } from 'react';
import { AppFrame } from '@/features/session/app-frame';
import { SessionGate } from '@/features/session/session-gate';

// Espace Compte et choix du profil : une session suffit, hors de tout profil (PIN-08).
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate requires="session">
      <AppFrame area="account">{children}</AppFrame>
    </SessionGate>
  );
}
