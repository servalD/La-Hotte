'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  getGetWardQueryKey,
  getListWardsQueryKey,
  useCreateWard,
  useCreateWardProfile,
  useGetWard,
  useListWards,
  useRequestWardRelease,
  useResetWardPassword,
  useRevokeWardSessions,
  type WardView,
} from '@wishlist/api-client';
import { useFormatter, useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { authErrorKey } from '@/features/auth/api-errors';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { FormError } from '@/features/auth/form-error';
import { ProfileAvatar } from '@/features/profiles/profile-avatar';
import { useReauth } from './reauth';

function WardDetail({
  ward,
  onFail,
}: {
  ward: WardView;
  onFail: (e: unknown, retry: () => void) => void;
}) {
  const t = useTranslations('wards');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const detail = useGetWard(ward.id);
  const revoke = useRevokeWardSessions();
  const reset = useResetWardPassword();
  const addProfile = useCreateWardProfile();
  const release = useRequestWardRelease();
  const [nameError, setNameError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetWardQueryKey(ward.id) });
    void queryClient.invalidateQueries({ queryKey: getListWardsQueryKey() });
  };

  // Chaque action du tuteur demande une ré-authentification récente (PRO-16) et en avertit l'enfant.
  function act(name: string, call: (done: () => void, fail: (e: unknown) => void) => void) {
    setNotice(null);
    const run = () => {
      call(
        () => {
          setNotice(t(`done.${name}`));
          refresh();
        },
        (e) => {
          onFail(e, run);
        },
      );
    };
    run();
  }

  function submitProfile(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = event.currentTarget;
    const displayName = text(new FormData(form), 'displayName').trim();
    if (displayName.length < 1 || displayName.length > 60) {
      setNameError(t('nameInvalid'));
      return;
    }
    setNameError(undefined);
    act('profile', (done, fail) => {
      addProfile.mutate(
        { id: ward.id, data: { displayName } },
        {
          onSuccess: () => {
            form.reset();
            done();
          },
          onError: fail,
        },
      );
    });
  }

  const sessions = detail.data?.sessions ?? [];

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-3">
      <p className="text-sm text-foreground-muted">{t('detailWho')}</p>
      <ul className="flex flex-col gap-2">
        {(detail.data?.profiles ?? ward.profiles).map((p) => (
          <li key={p.id} className="flex items-center gap-3">
            <ProfileAvatar name={p.displayName} color={p.accentColor} size={32} />
            <span>{p.displayName}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm">{t('sessions', { count: sessions.length })}</p>
      {sessions.length > 0 ? (
        <ul className="text-sm text-foreground-muted">
          {sessions.map((s) => (
            <li key={s.id} className="truncate">
              {s.userAgent || t('unknownDevice')} ·{' '}
              {format.dateTime(new Date(s.lastSeenAt), { dateStyle: 'medium', timeStyle: 'short' })}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={revoke.isPending}
          onClick={() => {
            act('sessions', (done, fail) => {
              revoke.mutate({ id: ward.id }, { onSuccess: done, onError: fail });
            });
          }}
        >
          {t('revoke')}
        </Button>
        <ConfirmButton
          variant="secondary"
          label={t('reset')}
          title={t('resetTitle')}
          description={t('resetBody')}
          confirmLabel={t('reset')}
          cancelLabel={t('cancel')}
          onConfirm={() => {
            act('reset', (done, fail) => {
              reset.mutate({ id: ward.id }, { onSuccess: done, onError: fail });
            });
          }}
        />
        <ConfirmButton
          variant="secondary"
          label={t('release')}
          title={t('releaseTitle')}
          description={t('releaseBody')}
          confirmLabel={t('release')}
          cancelLabel={t('cancel')}
          disabled={ward.releaseRequested}
          onConfirm={() => {
            act('release', (done, fail) => {
              release.mutate({ id: ward.id }, { onSuccess: done, onError: fail });
            });
          }}
        />
      </div>
      {ward.releaseRequested ? <p role="status">{t('releasePending')}</p> : null}
      <form onSubmit={submitProfile} noValidate className="flex flex-col gap-3">
        <Field
          label={t('addProfile')}
          hint={t('addProfileHint')}
          name="displayName"
          maxLength={60}
          error={nameError}
        />
        <Button
          type="submit"
          variant="secondary"
          className="self-start"
          disabled={addProfile.isPending}
        >
          {t('addProfileSubmit')}
        </Button>
      </form>
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  );
}

/**
 * Comptes sous tutelle (PRO-15, PRO-16) : des garde-fous, pas un accès au contenu. Chaque action
 * demande une ré-authentification récente ; l'enfant en est averti.
 */
export function WardsSection() {
  const t = useTranslations('wards');
  const ta = useTranslations('auth');
  const queryClient = useQueryClient();
  const reauth = useReauth();
  const list = useListWards();
  const create = useCreateWard();
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<'email' | 'name' | 'guardian', string>>>({});
  const [sent, setSent] = useState(false);

  function fail(e: unknown, retry: () => void) {
    if (reauth.handleError(e, retry)) return;
    setError(ta(`errors.${authErrorKey(e)}`));
  }

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = text(data, 'email').trim();
    const profileName = text(data, 'profileName').trim();
    const guardianAttested = data.get('guardian') === 'on';
    const next: typeof errors = {};
    if (!email.includes('@') || email.length > 254) next.email = ta('errors.emailInvalid');
    if (profileName.length < 1 || profileName.length > 60) next.name = t('nameInvalid');
    if (!guardianAttested) next.guardian = t('guardianRequired');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setError(null);
    setSent(false);
    const run = () => {
      create.mutate(
        { data: { email, profileName, guardianAttested } },
        {
          onSuccess: () => {
            form.reset();
            setSent(true);
            void queryClient.invalidateQueries({ queryKey: getListWardsQueryKey() });
          },
          onError: (e) => {
            fail(e, run);
          },
        },
      );
    };
    run();
  }

  return (
    <section aria-labelledby="wards-title" className="flex flex-col gap-4">
      <h1 id="wards-title" className="text-3xl font-semibold">
        {t('title')}
      </h1>
      <p className="text-sm text-foreground-muted">{t('who')}</p>
      <FormError message={error} />
      {list.data?.items.length === 0 ? <EmptyState compact title={t('none')} /> : null}
      <ul className="flex flex-col gap-3">
        {list.data?.items.map((ward) => (
          <li
            key={ward.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-3 font-medium">
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold"
                >
                  {ward.email.slice(0, 2).toUpperCase()}
                </span>
                {ward.email}
              </p>
              <Button
                variant="secondary"
                aria-expanded={open === ward.id}
                onClick={() => {
                  setOpen(open === ward.id ? null : ward.id);
                }}
              >
                {open === ward.id ? t('hide') : t('manage')}
              </Button>
            </div>
            {open === ward.id ? <WardDetail ward={ward} onFail={fail} /> : null}
          </li>
        ))}
      </ul>

      <form
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm"
      >
        <h3 className="font-display text-lg font-semibold">{t('create.title')}</h3>
        <p className="text-sm text-foreground-muted">{t('create.who')}</p>
        <Field
          label={t('create.email')}
          name="email"
          type="email"
          autoComplete="off"
          error={errors.email}
        />
        <Field
          label={t('create.profileName')}
          name="profileName"
          maxLength={60}
          error={errors.name}
        />
        <div className="flex flex-col gap-1.5">
          <div className="flex items-start gap-3">
            <input
              id="guardian"
              name="guardian"
              type="checkbox"
              className="size-5 shrink-0 self-center"
            />
            <Label htmlFor="guardian" className="flex min-h-touch flex-1 items-center font-normal">
              {t('create.guardian')}
            </Label>
          </div>
          {errors.guardian ? (
            <p role="alert" className="text-sm text-danger">
              {errors.guardian}
            </p>
          ) : null}
        </div>
        <Button type="submit" className="self-start" disabled={create.isPending}>
          {t('create.submit')}
        </Button>
        {sent ? <p role="status">{t('create.sent')}</p> : null}
      </form>
      {reauth.dialog}
    </section>
  );
}
