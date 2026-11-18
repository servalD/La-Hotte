'use client';

import { announceMoment } from '@/lib/pwa/engagement';
import { useQueryClient } from '@tanstack/react-query';
import {
  CircleMemberViewSource,
  type CreatedInvitationView,
  CreateInvitationDtoKind,
  getListInvitationsQueryKey,
  OpenInvitationViewKind,
  OpenInvitationViewProposal,
  useCreateInvitation,
  useGetCircle,
  useGetOwnProfile,
  useListInvitations,
  useRevokeInvitation,
} from '@wishlist/api-client';
import { useFormatter, useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { authErrorKey } from '@/features/auth/api-errors';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { FormError } from '@/features/auth/form-error';

/**
 * Invitations (LNK-01, PRO-11). Le lien n'est montré qu'à sa création : seul son condensat reste
 * côté serveur. Le jeton va dans le fragment, qui ne part jamais au serveur.
 */
export function InvitationsScreen() {
  const t = useTranslations('invitations');
  const ta = useTranslations('auth');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const { data: profile } = useGetOwnProfile();
  const circle = useGetCircle();
  const list = useListInvitations();
  const create = useCreateInvitation();
  const revoke = useRevokeInvitation();
  const [kind, setKind] = useState<CreateInvitationDtoKind>(CreateInvitationDtoKind.LINK);
  const [created, setCreated] = useState<CreatedInvitationView | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListInvitationsQueryKey() });
  };
  const others = circle.data?.items.filter((m) => m.source === CircleMemberViewSource.LINK) ?? [];

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = text(form, 'email').trim();
    if (email && (!email.includes('@') || email.length > 254)) {
      setEmailError(ta('errors.emailInvalid'));
      return;
    }
    setEmailError(undefined);
    setError(null);
    setCopied(false);
    const target = text(form, 'target');
    create.mutate(
      {
        data: {
          kind,
          email: email || undefined,
          ...(kind === CreateInvitationDtoKind.PROFILE
            ? { targetProfileId: target || undefined, profileIsChild: form.get('child') === 'on' }
            : {}),
        },
      },
      {
        onSuccess: (view) => {
          setCreated(view);
          announceMoment('invitation');
          refresh();
        },
        onError: (e) => {
          setError(ta(`errors.${authErrorKey(e)}`));
        },
      },
    );
  }

  const url = created ? `${window.location.origin}/invitations/open#${created.token}` : '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <form
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4"
        aria-labelledby="invite-title"
      >
        <h2 id="invite-title" className="text-lg font-semibold">
          {t('new.title')}
        </h2>
        <p className="text-sm text-foreground-muted">
          {kind === CreateInvitationDtoKind.LINK ? t('new.whoLink') : t('new.whoProfile')}
        </p>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t('new.kind')}</legend>
          {Object.values(CreateInvitationDtoKind)
            .filter((k) => k === CreateInvitationDtoKind.LINK || !profile?.isChild)
            .map((value) => (
              <div key={value} className="flex items-center gap-3">
                <input
                  id={`kind-${value}`}
                  type="radio"
                  name="kind"
                  className="size-5"
                  checked={kind === value}
                  onChange={() => {
                    setKind(value);
                  }}
                />
                <Label
                  htmlFor={`kind-${value}`}
                  className="flex min-h-touch flex-1 items-center font-normal"
                >
                  {t(`kinds.${value}`)}
                </Label>
              </div>
            ))}
        </fieldset>
        <Field
          label={t('new.email')}
          hint={t('new.emailHint')}
          name="email"
          type="email"
          error={emailError}
        />
        {kind === CreateInvitationDtoKind.PROFILE ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="target">{t('new.target')}</Label>
              <select
                id="target"
                name="target"
                className="h-touch rounded-md border border-border-strong bg-surface px-2 text-base"
                defaultValue=""
              >
                <option value="">{t('new.targetMine')}</option>
                {others.map((m) => (
                  <option key={m.profileId} value={m.profileId}>
                    {t('new.targetOther', { name: m.displayName })}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-start gap-3">
              <input
                id="child"
                name="child"
                type="checkbox"
                className="size-5 shrink-0 self-center"
              />
              <Label htmlFor="child" className="flex min-h-touch flex-1 items-center font-normal">
                {t('new.child')}
              </Label>
            </div>
          </>
        ) : null}
        <FormError message={error} />
        <Button type="submit" className="self-start" disabled={create.isPending}>
          {create.isPending ? t('new.creating') : t('new.submit')}
        </Button>
      </form>

      {created ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4"
        >
          <p className="font-medium">{t('created.title')}</p>
          <p className="text-sm text-foreground-muted">
            {t('created.once', {
              date: format.dateTime(new Date(created.expiresAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}
          </p>
          <p className="font-mono text-sm break-all">{url}</p>
          <Button variant="secondary" className="self-start" onClick={() => void copy()}>
            {copied ? t('created.copied') : t('created.copy')}
          </Button>
        </div>
      ) : null}

      <section aria-labelledby="open-title" className="flex flex-col gap-3">
        <h2 id="open-title" className="text-lg font-semibold">
          {t('open.title')}
        </h2>
        {list.data?.items.length === 0 ? <p>{t('open.none')}</p> : null}
        <ul className="flex flex-col gap-2">
          {list.data?.items.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4"
            >
              <div>
                <p className="font-medium">
                  {invitation.kind === OpenInvitationViewKind.PROFILE
                    ? t('kinds.PROFILE')
                    : t('kinds.LINK')}
                  {invitation.proposal === OpenInvitationViewProposal.PENDING
                    ? ` · ${t('open.pending')}`
                    : ''}
                  {invitation.proposal === OpenInvitationViewProposal.ACCEPTED
                    ? ` · ${t('open.accepted')}`
                    : ''}
                  {invitation.proposal === OpenInvitationViewProposal.REFUSED
                    ? ` · ${t('open.refused')}`
                    : ''}
                </p>
                <p className="text-sm text-foreground-muted">
                  {t('open.expires', {
                    date: format.dateTime(new Date(invitation.expiresAt), { dateStyle: 'medium' }),
                  })}
                </p>
              </div>
              <ConfirmButton
                variant="secondary"
                label={t('open.revoke')}
                title={t('open.revokeTitle')}
                description={t('open.revokeBody')}
                confirmLabel={t('open.revoke')}
                cancelLabel={t('cancel')}
                onConfirm={() => {
                  revoke.mutate({ id: invitation.id }, { onSuccess: refresh });
                }}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
