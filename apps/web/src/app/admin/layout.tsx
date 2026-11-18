import type { ReactNode } from 'react';
import { AppFrame } from '@/features/session/app-frame';
import { SessionGate } from '@/features/session/session-gate';

// RBAC-01, RBAC-05 : espace d'administration, hors de tout profil. L'API répond 404 à qui n'a
// pas le rôle ; l'interface n'ajoute aucune règle.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate requires="session">
      <AppFrame area="admin">{children}</AppFrame>
    </SessionGate>
  );
}
