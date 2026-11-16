'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  DigestFrequency,
  getGetNotificationPreferencesQueryKey,
  type NotificationPreferencesView,
  useGetNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const CHANNELS = ['IN_APP', 'PUSH', 'EMAIL'] as const;

function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function fromTime(value: FormDataEntryValue | null, fallback: number): number {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return fallback;
  const [h, m] = value.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** NOT-04, NOT-14, NOT-17, RT-11 : préférences du profil ; la sécurité reste cochée. */
export function NotificationPreferencesSection() {
  const t = useTranslations('notificationPrefs');
  const { data } = useGetNotificationPreferences();
  if (!data) return <p role="status">{t('loading')}</p>;
  return <PreferencesForm prefs={data} />;
}

function PreferencesForm({ prefs }: { prefs: NotificationPreferencesView }) {
  const t = useTranslations('notificationPrefs');
  const queryClient = useQueryClient();
  const update = useUpdateNotificationPreferences();
  const [saved, setSaved] = useState(false);
  const categories = [...new Set(prefs.channels.map((c) => c.category))];

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    update.mutate(
      {
        data: {
          channels: prefs.channels
            .filter((c) => !c.locked)
            .map((c) => ({
              category: c.category,
              channel: c.channel,
              enabled: form.get(`${c.category}.${c.channel}`) === 'on',
            })),
          quietEnabled: form.get('quietEnabled') === 'on',
          quietStart: fromTime(form.get('quietStart'), prefs.quietStart),
          quietEnd: fromTime(form.get('quietEnd'), prefs.quietEnd),
          digest: (form.get('digest') as DigestFrequency | null) ?? prefs.digest,
          sharePresence: form.get('sharePresence') === 'on',
        },
      },
      {
        onSuccess: () => {
          setSaved(true);
          void queryClient.invalidateQueries({
            queryKey: getGetNotificationPreferencesQueryKey(),
          });
        },
      },
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <h2 className="text-xl font-semibold">{t('title')}</h2>
      <table className="text-sm">
        <caption className="sr-only">{t('caption')}</caption>
        <thead>
          <tr>
            <th scope="col" className="text-left">
              {t('category')}
            </th>
            {CHANNELS.map((channel) => (
              <th key={channel} scope="col">
                {t(`channels.${channel}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => (
            <tr key={category}>
              <th scope="row" className="py-2 text-left font-normal">
                {t(`categories.${category}`)}
              </th>
              {CHANNELS.map((channel) => {
                const state = prefs.channels.find(
                  (c) => c.category === category && c.channel === channel,
                );
                return (
                  <td key={channel} className="text-center">
                    <input
                      type="checkbox"
                      className="size-5"
                      name={`${category}.${channel}`}
                      aria-label={`${t(`categories.${category}`)} : ${t(`channels.${channel}`)}`}
                      defaultChecked={state?.enabled ?? false}
                      disabled={state?.locked ?? false}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-foreground-muted">{t('securityLocked')}</p>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold">{t('quiet')}</legend>
        <label className="flex min-h-touch items-center gap-2">
          <input type="checkbox" name="quietEnabled" defaultChecked={prefs.quietEnabled} />
          {t('quietEnabled')}
        </label>
        <div className="flex gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="quietStart">{t('from')}</Label>
            <input
              id="quietStart"
              name="quietStart"
              type="time"
              defaultValue={toTime(prefs.quietStart)}
              className="h-touch rounded-md border border-border-strong bg-surface px-2"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="quietEnd">{t('to')}</Label>
            <input
              id="quietEnd"
              name="quietEnd"
              type="time"
              defaultValue={toTime(prefs.quietEnd)}
              className="h-touch rounded-md border border-border-strong bg-surface px-2"
            />
          </div>
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <Label htmlFor="digest">{t('digest')}</Label>
        <select
          id="digest"
          name="digest"
          defaultValue={prefs.digest}
          className="h-touch rounded-md border border-border-strong bg-surface px-3"
        >
          {Object.values(DigestFrequency).map((value) => (
            <option key={value} value={value}>
              {t(`digests.${value}`)}
            </option>
          ))}
        </select>
        {/* NOT-08, UX-04 : qui lit le résumé. */}
        <p className="text-sm text-foreground-muted">{t('digestWho')}</p>
      </div>

      <label className="flex min-h-touch items-center gap-2">
        <input type="checkbox" name="sharePresence" defaultChecked={prefs.sharePresence} />
        {t('sharePresence')}
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={update.isPending}>
          {t('save')}
        </Button>
        {saved ? <p role="status">{t('saved')}</p> : null}
      </div>
    </form>
  );
}
