import type { ReactNode } from 'react';
import { AppFrame } from '@/features/session/app-frame';
import { ProfileBoot } from '@/features/session/profile-boot';
import { SessionGate } from '@/features/session/session-gate';
import { OfflineProvider } from '@/lib/offline/offline-provider';
import { RealtimeProvider } from '@/lib/realtime/realtime-provider';

// Écrans d'un profil : session ouverte, profil actif et déverrouillé (PIN-02). Le contenu n'est
// monté qu'une fois le démarrage du profil décidé (PIN-07) : aucune lecture avant le verrou.
export default function ProfileLayout({ children }: { children: ReactNode }) {
  return (
    // OFF-20, OFF-27 : coffre du profil, et démarrage hors ligne sur le dernier profil.
    <OfflineProvider>
      <SessionGate requires="profile">
        {/* RT-01 : un client temps réel, lié au profil actif déverrouillé. */}
        <RealtimeProvider>
          <AppFrame area="profile">
            <ProfileBoot>{children}</ProfileBoot>
          </AppFrame>
        </RealtimeProvider>
      </SessionGate>
    </OfflineProvider>
  );
}
