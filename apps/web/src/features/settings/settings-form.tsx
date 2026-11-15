'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  getGetOwnProfileQueryKey,
  type ProfileView,
  UpdateProfileDtoPinRelock,
  useGetOwnProfile,
  useUpdateOwnProfile,
} from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { authErrorKey } from '@/features/auth/api-errors';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { FormError } from '@/features/auth/form-error';

const LOCALES = ['fr', 'en'] as const;
const RELOCK = Object.values(UpdateProfileDtoPinRelock);
const WEAKER: Record<string, number> = { EVERY_OPEN: 0, IDLE_15: 1, NEVER: 2 };

function SelectField({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue={value}
        className="h-touch rounded-md border border-border-strong bg-surface px-2 text-base"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Réglages du profil actif (PRO-02, PRO-03, PIN-07). `If-Match` porte la version lue (API-17). */
function Form({ profile }: { profile: ProfileView }) {
  const t = useTranslations('settings');
  const ta = useTranslations('auth');
  const queryClient = useQueryClient();
  const update = useUpdateOwnProfile({
    request: { headers: { 'If-Match': `"${profile.version}"` } },
  });
  const [errors, setErrors] = useState<
    Partial<Record<'displayName' | 'birthday' | 'currentPin', string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [stale, setStale] = useState(false);

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const displayName = text(form, 'displayName').trim();
    const day = text(form, 'day').trim();
    const month = text(form, 'month').trim();
    const year = text(form, 'year').trim();
    const pinRelock = text(form, 'pinRelock') as UpdateProfileDtoPinRelock;
    const currentPin = text(form, 'currentPin');

    const next: typeof errors = {};
    if (displayName.length < 1 || displayName.length > 60)
      next.displayName = ta('errors.displayNameInvalid');
    const hasDate = day !== '' || month !== '';
    const d = Number(day);
    const m = Number(month);
    if (hasDate && !(d >= 1 && d <= 31 && m >= 1 && m <= 12)) next.birthday = t('birthdayInvalid');
    const weakening = profile.hasPin && (WEAKER[pinRelock] ?? 0) > (WEAKER[profile.pinRelock] ?? 0);
    if (weakening && !/^[0-9]{4,8}$/.test(currentPin)) next.currentPin = t('currentPinNeeded');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setFormError(null);
    setSaved(false);
    update.mutate(
      {
        data: {
          displayName,
          birthday: hasDate ? { day: d, month: m, year: year ? Number(year) : null } : null,
          locale: text(form, 'locale'),
          pinRelock,
          currentPin: weakening ? currentPin : undefined,
        },
      },
      {
        onSuccess: (view) => {
          queryClient.setQueryData(getGetOwnProfileQueryKey(), view);
          setSaved(true);
          setStale(false);
        },
        onError: (e) => {
          if (e instanceof ApiError && e.status === 412) {
            // Version dépassée : on relit l'état courant (API-17), sans écraser l'autre modification.
            setStale(true);
            void queryClient.invalidateQueries({ queryKey: getGetOwnProfileQueryKey() });
          } else {
            setFormError(ta(`errors.${authErrorKey(e)}`));
          }
        },
      },
    );
  }

  return (
    <form
      // La clé relance le formulaire quand une version plus récente est relue.
      key={profile.version}
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-4"
      aria-labelledby="settings-title"
    >
      <Field
        label={t('displayName')}
        hint={t('displayNameHint')}
        name="displayName"
        defaultValue={profile.displayName}
        maxLength={60}
        error={errors.displayName}
        required
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t('birthday')}</legend>
        <p className="text-sm text-foreground-muted">{t('birthdayHint')}</p>
        <div className="grid grid-cols-3 gap-3">
          <Field
            label={t('day')}
            name="day"
            inputMode="numeric"
            maxLength={2}
            defaultValue={profile.birthday?.day ?? ''}
          />
          <Field
            label={t('month')}
            name="month"
            inputMode="numeric"
            maxLength={2}
            defaultValue={profile.birthday?.month ?? ''}
          />
          <Field
            label={t('year')}
            name="year"
            inputMode="numeric"
            maxLength={4}
            defaultValue={profile.birthday?.year ?? ''}
          />
        </div>
        {errors.birthday ? (
          <p role="alert" className="text-sm text-danger">
            {errors.birthday}
          </p>
        ) : null}
      </fieldset>
      <SelectField
        label={t('language')}
        name="locale"
        value={profile.locale.slice(0, 2)}
        options={LOCALES.map((l) => ({ value: l, label: t(`languages.${l}`) }))}
      />
      <SelectField
        label={t('relock.label')}
        name="pinRelock"
        value={profile.pinRelock}
        options={RELOCK.map((r) => ({ value: r, label: t(`relock.${r}`) }))}
      />
      {profile.hasPin ? (
        <Field
          label={t('currentPin')}
          hint={t('currentPinHint')}
          name="currentPin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          error={errors.currentPin}
        />
      ) : null}
      {stale ? (
        <p role="alert" className="text-sm text-danger">
          {t('stale')}
        </p>
      ) : null}
      <FormError message={formError} />
      <Button type="submit" className="self-start" disabled={update.isPending}>
        {update.isPending ? t('saving') : t('save')}
      </Button>
      {saved ? <p role="status">{t('saved')}</p> : null}
    </form>
  );
}

export function SettingsForm() {
  const { data: profile } = useGetOwnProfile();
  return profile ? <Form profile={profile} /> : null;
}
