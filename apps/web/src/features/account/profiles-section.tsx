'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  type AccountProfileView,
  getListAccountProfilesQueryKey,
  useCreateAccountProfile,
  useDeleteAccountProfile,
  useDisableProfilePin,
  useListAccountProfiles,
  useResetProfilePin,
  useSetChildMarker,
} from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { authErrorKey } from '@/features/auth/api-errors';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { FormError } from '@/features/auth/form-error';
import { ProfileAvatar } from '@/features/profiles/profile-avatar';
import { useReauth } from './reauth';
import { TransferPanel } from './transfer-panel';

/**
 * Profils du compte (PRO-08, PIN-05, PIN-08, PRO-09). L'espace Compte ne montre que des
 * métadonnées : jamais un souhait, une réservation ni un commentaire.
 */
export function ProfilesSection() {
  const t = useTranslations('accountProfiles');
  const ta = useTranslations('auth');
  const queryClient = useQueryClient();
  const reauth = useReauth();
  const { data } = useListAccountProfiles();
  const create = useCreateAccountProfile();
  const remove = useDeleteAccountProfile();
  const disablePin = useDisableProfilePin();
  const resetPin = useResetProfilePin();
  const marker = useSetChildMarker();
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [resetting, setResetting] = useState<string | null>(null);
  const [transferring, setTransferring] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | undefined>();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListAccountProfilesQueryKey() });
  };

  function guard(e: unknown, retry: () => void) {
    if (reauth.handleError(e, retry)) return;
    setError(ta(`errors.${authErrorKey(e)}`));
  }

  function submitCreate(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const displayName = text(data, 'displayName').trim();
    if (displayName.length < 1 || displayName.length > 60) {
      setNameError(ta('errors.displayNameInvalid'));
      return;
    }
    setNameError(undefined);
    setError(null);
    create.mutate(
      { data: { displayName, isChild: data.get('isChild') === 'on' } },
      {
        onSuccess: () => {
          form.reset();
          refresh();
        },
        onError: (e) => {
          setError(ta(`errors.${authErrorKey(e)}`));
        },
      },
    );
  }

  function deleteProfile(profile: AccountProfileView) {
    setError(null);
    remove.mutate(
      { id: profile.id },
      {
        onSuccess: refresh,
        onError: (e) => {
          guard(e, () => {
            deleteProfile(profile);
          });
        },
      },
    );
  }

  function removePin(profile: AccountProfileView) {
    setError(null);
    disablePin.mutate(
      { id: profile.id },
      {
        onSuccess: refresh,
        onError: (e) => {
          guard(e, () => {
            removePin(profile);
          });
        },
      },
    );
  }

  function toggleChild(profile: AccountProfileView) {
    setError(null);
    marker.mutate(
      { id: profile.id, data: { isChild: !profile.isChild } },
      {
        onSuccess: refresh,
        onError: (e) => {
          guard(e, () => {
            toggleChild(profile);
          });
        },
      },
    );
  }

  function submitReset(
    profile: AccountProfileView,
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
    event.preventDefault();
    const newPin = text(new FormData(event.currentTarget), 'pin');
    if (!/^[0-9]{4,8}$/.test(newPin)) {
      setPinError(ta('errors.pinFormat'));
      return;
    }
    setPinError(undefined);
    const attempt = () => {
      resetPin.mutate(
        { id: profile.id, data: { newPin } },
        {
          onSuccess: () => {
            setResetting(null);
            refresh();
          },
          onError: (e) => {
            guard(e, attempt);
          },
        },
      );
    };
    attempt();
  }

  return (
    <section aria-labelledby="profiles-title" className="flex flex-col gap-4">
      <h2 id="profiles-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p className="text-sm text-foreground-muted">{t('who')}</p>
      <FormError message={error} />

      <ul className="flex flex-col gap-3">
        {data?.items.map((profile) => (
          <li
            key={profile.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
          >
            <div className="flex items-center gap-3">
              <ProfileAvatar name={profile.displayName} color={profile.accentColor} size={40} />
              <div>
                <p className="font-medium">{profile.displayName}</p>
                <p className="text-sm text-foreground-muted">
                  {[
                    profile.isChild ? t('child') : t('adult'),
                    profile.hasPin ? t('hasPin') : t('noPin'),
                  ].join(' · ')}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setResetting(resetting === profile.id ? null : profile.id);
                  setPinError(undefined);
                }}
                aria-expanded={resetting === profile.id}
              >
                {profile.hasPin ? t('resetPin') : t('setPin')}
              </Button>
              {profile.hasPin ? (
                <ConfirmButton
                  variant="secondary"
                  label={t('disablePin')}
                  title={t('disablePinTitle', { name: profile.displayName })}
                  description={t('disablePinBody')}
                  confirmLabel={t('disablePin')}
                  cancelLabel={t('cancel')}
                  onConfirm={() => {
                    removePin(profile);
                  }}
                />
              ) : null}
              <Button
                variant="secondary"
                onClick={() => {
                  toggleChild(profile);
                }}
              >
                {profile.isChild ? t('markAdult') : t('markChild')}
              </Button>
              <Button
                variant="secondary"
                aria-expanded={transferring === profile.id}
                onClick={() => {
                  setTransferring(transferring === profile.id ? null : profile.id);
                }}
              >
                {t('changeAccount')}
              </Button>

              <ConfirmButton
                label={t('delete')}
                title={t('deleteTitle', { name: profile.displayName })}
                description={t('deleteBody')}
                confirmLabel={t('delete')}
                cancelLabel={t('cancel')}
                onConfirm={() => {
                  deleteProfile(profile);
                }}
              />
            </div>
            {transferring === profile.id ? (
              <TransferPanel profile={profile} isLast={data.items.length === 1} />
            ) : null}
            {resetting === profile.id ? (
              <form
                onSubmit={(e) => {
                  submitReset(profile, e);
                }}
                noValidate
                className="flex flex-col gap-3"
              >
                <Field
                  label={t('newPin')}
                  hint={t('newPinHint')}
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={8}
                  error={pinError}
                />
                <Button type="submit" className="self-start" disabled={resetPin.isPending}>
                  {t('confirmPin')}
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>

      <form
        onSubmit={submitCreate}
        noValidate
        className="flex flex-col gap-3 border-t border-border pt-4"
      >
        <h3 className="font-semibold">{t('create.title')}</h3>
        <Field
          label={t('create.name')}
          name="displayName"
          maxLength={60}
          error={nameError}
          required
        />
        <div className="flex items-start gap-3">
          <input
            id="child"
            name="isChild"
            type="checkbox"
            className="size-5 shrink-0 self-center"
          />
          <Label htmlFor="child" className="flex min-h-touch flex-1 items-center font-normal">
            {t('create.child')}
          </Label>
        </div>
        <Button type="submit" className="self-start" disabled={create.isPending}>
          {t('create.submit')}
        </Button>
      </form>
      {reauth.dialog}
    </section>
  );
}
