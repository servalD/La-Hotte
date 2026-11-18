'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  getGetPlatformSettingsQueryKey,
  type PlatformSettingKey,
  type PlatformSettingsView,
  type UpdateSettingDtoValue,
  useGetPlatformSettings,
  useUpdatePlatformSetting,
} from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useReauth } from '@/features/account/reauth';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { adminErrorKey } from './api-errors';

const lines = (raw: string): string[] =>
  raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/** Un réglage, son formulaire et son motif (ADM-09, RBAC-06). */
function SettingForm({
  settingKey,
  label,
  hint,
  children,
  read,
}: {
  settingKey: PlatformSettingKey;
  label: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
  read: (form: FormData) => UpdateSettingDtoValue;
}) {
  const t = useTranslations('admin.settings');
  const ta = useTranslations('admin');
  const te = useTranslations('admin.errors');
  const id = useId();
  const queryClient = useQueryClient();
  const update = useUpdatePlatformSetting();
  const reauth = useReauth();
  const [message, setMessage] = useState<string | null>(null);

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = read(form);
    const reason = text(form, 'reason').trim();
    const attempt = () => {
      update.mutate(
        { key: settingKey, data: { value, reason } },
        {
          onSuccess: (values) => {
            queryClient.setQueryData(getGetPlatformSettingsQueryKey(), values);
            setMessage(t('saved'));
          },
          onError: (e) => {
            if (reauth.handleError(e, attempt)) return;
            setMessage(te(adminErrorKey(e)));
          },
        },
      );
    };
    setMessage(null);
    attempt();
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
      onSubmit={submit}
    >
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {hint ? <p className="text-sm text-foreground-muted">{hint}</p> : null}
      <Field
        label={ta('reason')}
        hint={ta('reasonHint')}
        name="reason"
        required
        minLength={10}
        maxLength={500}
      />
      <div>
        <Button type="submit" disabled={update.isPending}>
          {t('save')}
        </Button>
      </div>
      {message ? <p role="status">{message}</p> : null}
      {reauth.dialog}
    </form>
  );
}

function Forms({ values }: { values: PlatformSettingsView }) {
  const t = useTranslations('admin.settings');
  const area = 'min-h-24 rounded-md border border-border bg-surface p-2';
  return (
    <div className="flex flex-col gap-4">
      <SettingForm
        settingKey="registration_mode"
        label={t('registration')}
        read={(form) => (text(form, 'value') || null) as UpdateSettingDtoValue}
      >
        {(id) => (
          <select
            id={id}
            name="value"
            defaultValue={values.registration_mode ?? ''}
            className="min-h-touch rounded-md border border-border bg-surface px-3"
          >
            <option value="">{t('registrationDefault')}</option>
            <option value="OPEN">{t('OPEN')}</option>
            <option value="INVITE_ONLY">{t('INVITE_ONLY')}</option>
          </select>
        )}
      </SettingForm>
      <SettingForm
        settingKey="forbidden_terms"
        label={t('terms')}
        hint={t('termsHint')}
        read={(form) => lines(text(form, 'value'))}
      >
        {(id) => (
          <textarea
            id={id}
            name="value"
            className={area}
            defaultValue={values.forbidden_terms.join('\n')}
          />
        )}
      </SettingForm>
      <SettingForm
        settingKey="blocked_domains"
        label={t('domains')}
        hint={t('domainsHint')}
        read={(form) => lines(text(form, 'value'))}
      >
        {(id) => (
          <textarea
            id={id}
            name="value"
            className={area}
            defaultValue={values.blocked_domains.join('\n')}
          />
        )}
      </SettingForm>
      <SettingForm
        settingKey="extraction_daily_limit"
        label={t('limit')}
        hint={t('limitHint')}
        read={(form) => {
          const raw = text(form, 'value').trim();
          return raw === '' ? null : Number(raw);
        }}
      >
        {(id) => (
          <input
            id={id}
            name="value"
            type="number"
            min={0}
            max={1000}
            defaultValue={values.extraction_daily_limit ?? ''}
            className="min-h-touch rounded-md border border-border bg-surface px-3"
          />
        )}
      </SettingForm>
    </div>
  );
}

/** ADM-09 : réglages de plateforme, chacun avec son motif. */
export function PlatformSettings() {
  const settings = useGetPlatformSettings();
  return settings.data ? <Forms values={settings.data} /> : null;
}
