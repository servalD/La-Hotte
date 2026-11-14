'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  type AccountProfileView,
  getGetAccountProfileTransferQueryKey,
  getListAccountProfilesQueryKey,
  type CreatedTransferView,
  RequestTransferDtoKind,
  RequestTransferDtoPinChoice,
  useCancelAccountProfileTransfer,
  useGetAccountProfileTransfer,
  useRequestTransfer,
} from '@wishlist/api-client';
import { useFormatter, useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { authErrorKey } from '@/features/auth/api-errors';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { FormError } from '@/features/auth/form-error';
import { useReauth } from './reauth';

/**
 * Changement de compte d'un profil (PRO-12 passage, PRO-13 détachement), demandé depuis le compte
 * d'origine après ré-authentification. Le jeton d'un passage n'est montré qu'une fois.
 */
export function TransferPanel({
  profile,
  isLast,
}: {
  profile: AccountProfileView;
  isLast: boolean;
}) {
  const t = useTranslations('transferPanel');
  const ta = useTranslations('auth');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const reauth = useReauth();
  const current = useGetAccountProfileTransfer(profile.id, { query: { retry: false } });
  const request = useRequestTransfer();
  const cancel = useCancelAccountProfileTransfer();
  const [kind, setKind] = useState<RequestTransferDtoKind>(RequestTransferDtoKind.MOVE);
  const [choice, setChoice] = useState<RequestTransferDtoPinChoice>(
    profile.hasPin ? RequestTransferDtoPinChoice.KEEP : RequestTransferDtoPinChoice.NEW,
  );
  const [created, setCreated] = useState<CreatedTransferView | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [pinError, setPinError] = useState<string | undefined>();

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: getGetAccountProfileTransferQueryKey(profile.id),
    });
    void queryClient.invalidateQueries({ queryKey: getListAccountProfilesQueryKey() });
  };

  function fail(e: unknown, retry: () => void) {
    if (reauth.handleError(e, retry)) return;
    setError(ta(`errors.${authErrorKey(e)}`));
  }

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = text(form, 'email').trim();
    const newPin = text(form, 'newPin');
    const regroup = form.get('regroup') === 'on';
    let invalid = false;
    if (kind === RequestTransferDtoKind.DETACH && (!email.includes('@') || email.length > 254)) {
      setEmailError(ta('errors.emailInvalid'));
      invalid = true;
    } else setEmailError(undefined);
    // PRO-13 : l'adresse peut venir du profil ; ici on exige de la saisir pour ne rien deviner.
    if (choice === RequestTransferDtoPinChoice.NEW && !/^[0-9]{4,8}$/.test(newPin)) {
      setPinError(ta('errors.pinFormat'));
      invalid = true;
    } else setPinError(undefined);
    if (invalid) return;
    setError(null);
    const run = () => {
      request.mutate(
        {
          id: profile.id,
          data: {
            kind,
            regroup: kind === RequestTransferDtoKind.MOVE ? regroup : undefined,
            email: kind === RequestTransferDtoKind.DETACH ? email : undefined,
            pinChoice: choice,
            newPin: choice === RequestTransferDtoPinChoice.NEW ? newPin : undefined,
          },
        },
        {
          onSuccess: (view) => {
            setCreated(view);
            refresh();
          },
          onError: (e) => {
            fail(e, run);
          },
        },
      );
    };
    run();
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  if (current.isPending) return null;

  // Demande en cours : état et annulation (le compte d'origine peut annuler à tout moment).
  if (current.data) {
    const transfer = current.data;
    return (
      <div role="region" aria-label={t('current.title')} className="flex flex-col gap-2">
        <p className="font-medium">
          {t(transfer.kind === RequestTransferDtoKind.DETACH ? 'current.detach' : 'current.move')}
        </p>
        <ul className="list-disc pl-5 text-sm">
          <li>
            {transfer.profileConsentRequired
              ? transfer.profileConsented
                ? t('current.profileOk')
                : t('current.profileWaiting')
              : t('current.profileNotRequired')}
          </li>
          {transfer.kind === RequestTransferDtoKind.MOVE ? (
            <li>
              {transfer.destinationAccepted
                ? t('current.destinationOk')
                : t('current.destinationWaiting')}
            </li>
          ) : null}
          <li>
            {transfer.executesAt
              ? t('current.executes', { date: when(transfer.executesAt) })
              : t('current.expires', { date: when(transfer.expiresAt) })}
          </li>
        </ul>
        {created?.token ? (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <p className="text-sm">{t('token.once')}</p>
            <p className="font-mono text-sm break-all">{created.token}</p>
            <Button
              variant="secondary"
              className="self-start"
              onClick={() => void copy(created.token ?? '')}
            >
              {copied ? t('token.copied') : t('token.copy')}
            </Button>
          </div>
        ) : null}
        <FormError message={error} />
        <Button
          variant="secondary"
          className="self-start"
          disabled={cancel.isPending}
          onClick={() => {
            cancel.mutate({ id: profile.id }, { onSuccess: refresh });
          }}
        >
          {t('current.cancel')}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3" aria-label={t('title')}>
      <p className="text-sm text-foreground-muted">{t('who')}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t('kind')}</legend>
        {Object.values(RequestTransferDtoKind)
          .filter((k) => k === RequestTransferDtoKind.MOVE || (!profile.isChild && !isLast))
          .map((value) => (
            <div key={value} className="flex items-start gap-3">
              <input
                id={`k-${profile.id}-${value}`}
                type="radio"
                className="size-5 shrink-0 self-center"
                checked={kind === value}
                onChange={() => {
                  setKind(value);
                }}
              />
              <Label
                htmlFor={`k-${profile.id}-${value}`}
                className="flex min-h-touch flex-1 items-center font-normal"
              >
                {t(`kinds.${value}`)}
              </Label>
            </div>
          ))}
      </fieldset>
      {kind === RequestTransferDtoKind.DETACH ? (
        <Field
          label={t('email')}
          hint={t('emailHint')}
          name="email"
          type="email"
          autoComplete="off"
          error={emailError}
        />
      ) : isLast ? (
        <div className="flex items-start gap-3">
          <input
            id={`rg-${profile.id}`}
            name="regroup"
            type="checkbox"
            className="size-5 shrink-0 self-center"
          />
          <Label
            htmlFor={`rg-${profile.id}`}
            className="flex min-h-touch flex-1 items-center font-normal"
          >
            {t('regroup')}
          </Label>
        </div>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t('pinChoice')}</legend>
        {Object.values(RequestTransferDtoPinChoice)
          .filter((c) => c !== RequestTransferDtoPinChoice.KEEP || profile.hasPin)
          .map((value) => (
            <div key={value} className="flex items-start gap-3">
              <input
                id={`p-${profile.id}-${value}`}
                type="radio"
                className="size-5 shrink-0 self-center"
                checked={choice === value}
                onChange={() => {
                  setChoice(value);
                }}
              />
              <Label
                htmlFor={`p-${profile.id}-${value}`}
                className="flex min-h-touch flex-1 items-center font-normal"
              >
                {t(`pin.${value}`)}
              </Label>
            </div>
          ))}
      </fieldset>
      {choice === RequestTransferDtoPinChoice.NONE ? (
        <p role="note" className="rounded-md border border-border p-3 text-sm">
          {t('noneWarning')}
        </p>
      ) : null}
      {choice === RequestTransferDtoPinChoice.NEW ? (
        <Field
          label={t('newPin')}
          name="newPin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          error={pinError}
        />
      ) : null}
      <FormError message={error} />
      <Button type="submit" className="self-start" disabled={request.isPending}>
        {t('submit')}
      </Button>
      {reauth.dialog}
    </form>
  );
}
