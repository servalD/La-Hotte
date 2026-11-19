'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  type AccountProfileView,
  getGetSessionQueryKey,
  type ProfileSelectionView,
  useGetSession,
  useListAccountProfiles,
  useSelectProfile,
} from '@wishlist/api-client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ShieldIcon } from '@/components/ui/icons';
import { markLaunchHandled } from '@/lib/session/launch';
import { purgeUserData } from '@/lib/session/purge';
import { Skeleton } from '@/components/ui/skeleton';
import { PinEntry, PinNotice } from './pin-entry';
import { ProfileAvatar } from './profile-avatar';

/**
 * Choix du profil (PRO-07) et déverrouillage du profil actif. Le profil choisi devient actif avant
 * la vérification du PIN ; un profil à PIN reste verrouillé tant que le PIN juste n'est pas envoyé.
 * `unlockOnly` : l'écran de déverrouillage, limité au profil déjà actif.
 */
export function ProfileChooser({ unlockOnly = false }: { unlockOnly?: boolean }) {
  const t = useTranslations('profiles');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useGetSession();
  const { data, isPending, isError } = useListAccountProfiles();
  const select = useSelectProfile();
  const [asking, setAsking] = useState<AccountProfileView | null>(null);
  const [notice, setNotice] = useState<ProfileSelectionView | null>(null);

  const activeId = session?.session?.activeProfileId ?? null;
  const profiles = (data?.items ?? []).filter((p) => !unlockOnly || p.id === activeId);
  const pinTarget = asking ?? (unlockOnly ? (profiles.find((p) => p.hasPin) ?? null) : null);

  async function entered(selection: ProfileSelectionView) {
    // Un autre profil vient de devenir actif : rien de l'ancien ne doit rester (OFF-20).
    purgeUserData(queryClient);
    if (selection.profileUnlocked) markLaunchHandled();
    await queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
    if (selection.profileUnlocked) {
      if (selection.pinResetNoticeAt || selection.failedPinAttempts > 0) setNotice(selection);
      else router.replace('/');
    }
  }

  function choose(profile: AccountProfileView, pin?: string) {
    select.mutate(
      { data: { profileId: profile.id, pin } },
      {
        onSuccess: (selection) => {
          void entered(selection);
        },
        // Le serveur a déjà changé de profil (PRO-07), même si le PIN est faux : on efface l'ancien.
        onError: () => {
          // On garde la mutation : son erreur (PIN faux, attente) reste affichée.
          purgeUserData(queryClient, { keepMutations: true });
        },
      },
    );
  }

  if (notice)
    return (
      <PinNotice
        selection={notice}
        onContinue={() => {
          router.replace('/');
        }}
      />
    );

  if (isPending) return <Skeleton className="h-32 w-full" />;
  if (isError) return <p role="alert">{t('loadError')}</p>;

  if (pinTarget) {
    return (
      <PinEntry
        profileName={pinTarget.displayName}
        pending={select.isPending}
        error={select.error}
        onSubmit={(pin) => {
          choose(pinTarget, pin);
        }}
        onCancel={
          unlockOnly
            ? undefined
            : () => {
                setAsking(null);
                select.reset();
              }
        }
      />
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {profiles.map((profile) => (
        <li key={profile.id}>
          <Button
            variant="secondary"
            className="h-auto! w-full flex-col gap-3 rounded-xl py-6 shadow-sm transition-shadow hover:shadow-md"
            disabled={select.isPending}
            onClick={() => {
              if (profile.hasPin) {
                // Le profil devient actif, verrouillé, puis le PIN est demandé (PRO-07).
                setAsking(profile);
                select.mutate(
                  { data: { profileId: profile.id } },
                  {
                    onSuccess: () => {
                      purgeUserData(queryClient);
                      void queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
                    },
                  },
                );
              } else {
                choose(profile);
              }
            }}
          >
            <ProfileAvatar name={profile.displayName} color={profile.accentColor} size={88} />
            <span className="font-display text-lg font-semibold">{profile.displayName}</span>
            {profile.hasPin ? (
              <span className="flex items-center gap-1 text-xs text-foreground-muted">
                <ShieldIcon width={14} height={14} />
                {t('protected')}
              </span>
            ) : null}
          </Button>
        </li>
      ))}
    </ul>
  );
}
