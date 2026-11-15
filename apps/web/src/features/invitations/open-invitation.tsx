'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  getGetCircleQueryKey,
  getListLinksQueryKey,
  type InvitationPreviewView,
  type ProfileInvitationPreviewView,
  RedeemedInvitationViewStatus,
  useAcceptProfileInvitation,
  useGetSession,
  useInspectInvitation,
  useInspectProfileInvitation,
  useRedeemInvitation,
} from '@wishlist/api-client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { authErrorKey } from '@/features/auth/api-errors';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { FormError } from '@/features/auth/form-error';
import { useFragmentToken } from '@/features/auth/fragment-token';

type Found =
  | { kind: 'profile'; preview: ProfileInvitationPreviewView }
  | { kind: 'link'; preview: InvitationPreviewView }
  | { kind: 'sign-in' }
  | { kind: 'invalid' };

/**
 * Ouverture d'une invitation (LNK-06, LNK-07, PRO-11). Le jeton vient du fragment. Le refus est
 * commun : jeton inconnu, expiré, retiré ou bloqué donnent le même écran (LNK-07).
 */
export function OpenInvitation() {
  const t = useTranslations('open');
  const ta = useTranslations('auth');
  const token = useFragmentToken();
  const queryClient = useQueryClient();
  const { data: session } = useGetSession();
  const inspectProfile = useInspectProfileInvitation();
  const inspectLink = useInspectInvitation();
  const redeem = useRedeemInvitation();
  const accept = useAcceptProfileInvitation();
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [done, setDone] = useState<string | null>(null);
  const started = useRef(false);

  const ready = session !== undefined;
  const unlocked = Boolean(session?.session?.activeProfileId && session.session.profileUnlocked);

  useEffect(() => {
    if (!token || !ready || started.current) return;
    started.current = true;
    inspectProfile.mutate(
      { data: { token } },
      {
        onSuccess: (preview) => {
          setFound({ kind: 'profile', preview });
        },
        onError: () => {
          if (!unlocked) {
            setFound({ kind: 'sign-in' });
            return;
          }
          inspectLink.mutate(
            { data: { token } },
            {
              onSuccess: (preview) => {
                setFound({ kind: 'link', preview });
              },
              onError: () => {
                setFound({ kind: 'invalid' });
              },
            },
          );
        },
      },
    );
  }, [token, ready, unlocked, inspectProfile, inspectLink]);

  if (token === undefined) return null;
  if (token === null) return <p role="alert">{t('invalid')}</p>;
  if (!found) return <p role="status">{t('loading')}</p>;

  if (done) {
    return (
      <div role="status" className="flex flex-col gap-3">
        <p className="font-medium">{done}</p>
        <Button asChild>
          <Link href="/circle">{t('toCircle')}</Link>
        </Button>
      </div>
    );
  }

  if (found.kind === 'invalid') return <p role="alert">{t('invalid')}</p>;

  if (found.kind === 'sign-in') {
    return (
      <div className="flex flex-col gap-3">
        <p>{t('signInFirst')}</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/auth/login">{ta('login.submit')}</Link>
          </Button>
          <Button asChild variant="secondary">
            {/* Le jeton suit dans le fragment : jamais dans une adresse envoyée au serveur. */}
            <Link href={`/auth/register#${token}`}>{ta('links.register')}</Link>
          </Button>
        </div>
        <p className="text-sm text-foreground-muted">{t('reopen')}</p>
      </div>
    );
  }

  if (found.kind === 'link') {
    const name = found.preview.inviterName ?? t('someone');
    return (
      <div className="flex flex-col gap-3">
        <p>{t('linkBody', { name })}</p>
        <FormError message={error} />
        <Button
          className="self-start"
          disabled={redeem.isPending}
          onClick={() => {
            setError(null);
            redeem.mutate(
              { data: { token } },
              {
                onSuccess: (view) => {
                  void queryClient.invalidateQueries({ queryKey: getListLinksQueryKey() });
                  void queryClient.invalidateQueries({ queryKey: getGetCircleQueryKey() });
                  setDone(
                    view.status === RedeemedInvitationViewStatus.ACCEPTED
                      ? t('linked')
                      : t('linkedPendingGuardian'),
                  );
                },
                onError: (e) => {
                  // Refus commun (LNK-07) : on ne dit pas pourquoi.
                  setError(
                    e instanceof ApiError && e.status === 404
                      ? t('invalid')
                      : ta(`errors.${authErrorKey(e)}`),
                  );
                },
              },
            );
          }}
        >
          {t('accept')}
        </Button>
      </div>
    );
  }

  const preview = found.preview;

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const displayName = text(form, 'displayName').trim();
    const pin = text(form, 'pin');
    const email = text(form, 'email').trim();
    if (displayName.length < 1 || displayName.length > 60) {
      setNameError(ta('errors.displayNameInvalid'));
      return;
    }
    setNameError(undefined);
    setError(null);
    accept.mutate(
      {
        data: {
          token: token as string,
          displayName,
          pin: pin || undefined,
          email: preview.profileIsChild ? undefined : email || undefined,
        },
      },
      {
        onSuccess: () => {
          setDone(t('profileSent'));
        },
        onError: (e) => {
          setError(
            e instanceof ApiError && e.status === 404
              ? t('invalid')
              : ta(`errors.${authErrorKey(e)}`),
          );
        },
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-labelledby="auth-title">
      <p>
        {t(preview.profileIsChild ? 'profileBodyChild' : 'profileBody', {
          name: preview.inviterName,
        })}
      </p>
      <Field
        label={t('profileName')}
        name="displayName"
        maxLength={60}
        error={nameError}
        required
      />
      <Field
        label={t('profilePin')}
        hint={t('profilePinHint')}
        name="pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
      />
      {preview.profileIsChild ? null : (
        <Field label={t('profileEmail')} hint={t('profileEmailHint')} name="email" type="email" />
      )}
      <FormError message={error} />
      <Button type="submit" disabled={accept.isPending}>
        {t('profileSubmit')}
      </Button>
    </form>
  );
}
