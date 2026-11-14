import type { ReactNode } from 'react';
import { AppFrame } from '@/features/session/app-frame';
import { ProfileBoot } from '@/features/session/profile-boot';
import { SessionGate } from '@/features/session/session-gate';

// Écrans d'un profil : session ouverte, profil actif et déverrouillé (PIN-02).
export default function ProfileLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate requires="profile">
      <ProfileBoot />
      <AppFrame area="profile">{children}</AppFrame>
    </SessionGate>
  );
}
