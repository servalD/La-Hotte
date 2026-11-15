import type { ReactNode } from 'react';
import { AppFrame } from '@/features/session/app-frame';
import { ProfileBoot } from '@/features/session/profile-boot';
import { SessionGate } from '@/features/session/session-gate';

// Écrans d'un profil : session ouverte, profil actif et déverrouillé (PIN-02). Le contenu n'est
// monté qu'une fois le démarrage du profil décidé (PIN-07) : aucune lecture avant le verrou.
export default function ProfileLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate requires="profile">
      <AppFrame area="profile">
        <ProfileBoot>{children}</ProfileBoot>
      </AppFrame>
    </SessionGate>
  );
}
