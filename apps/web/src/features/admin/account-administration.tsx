'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  type AccountMetadataView,
  AccountRole,
  getSearchAccountQueryKey,
  useChangeAccountRole,
  useForceAccountLogout,
  useReactivateAccount,
  useRequestAccountTotpReset,
  useRestoreAccountPublication,
  useSearchAccount,
  useSuspendAccount,
} from '@wishlist/api-client';
import { useFormatter, useTranslations } from 'next-intl';
import { type SyntheticEvent, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { useReauth } from '@/features/account/reauth';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';
import { adminErrorKey } from './api-errors';
import { ReasonActions } from './reason-actions';

type Action = 'suspend' | 'reactivate' | 'forceLogout' | 'totpReset' | 'restorePublication';

function Metadata({ account }: { account: AccountMetadataView }) {
  const t = useTranslations('admin.accounts');
  const ta = useTranslations('admin');
  const format = useFormatter();
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const rows: [string, string][] = [
    [t('created'), date(account.createdAt)],
    [t('lastSignIn'), account.lastSignInAt ? date(account.lastSignInAt) : ta('never')],
    [t('profiles'), String(account.profileCount)],
    [t('lists'), String(account.listCount)],
    [t('role'), t(`roles.${account.role}`)],
    [t('status'), t(`statuses.${account.status}`)],
    [t('totp'), account.totpEnabled ? ta('yes') : ta('no')],
    [t('verified'), account.emailVerified ? ta('yes') : ta('no')],
    [
      t('publication'),
      account.publicationSuspended ? t('publicationSuspended') : t('publicationOpen'),
    ],
  ];
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-foreground-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {account.suspensions.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">{t('suspensions')}</h3>
          <ul className="text-sm">
            {account.suspensions.map((s) => (
              <li key={s.at}>
                {date(s.at)} ·{' '}
                {t(`events.${s.action.replaceAll('.', '_')}` as 'events.account_suspend')}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Actions({ account, onDone }: { account: AccountMetadataView; onDone: () => void }) {
  const t = useTranslations('admin.accounts');
  const te = useTranslations('admin.errors');
  const ta = useTranslations('admin');
  const roleId = useId();
  const reauth = useReauth();
  const suspend = useSuspendAccount();
  const reactivate = useReactivateAccount();
  const forceLogout = useForceAccountLogout();
  const totpReset = useRequestAccountTotpReset();
  const restore = useRestoreAccountPublication();
  const changeRole = useChangeAccountRole();
  const [message, setMessage] = useState<string | null>(null);
  const pending =
    suspend.isPending ||
    reactivate.isPending ||
    forceLogout.isPending ||
    totpReset.isPending ||
    restore.isPending ||
    changeRole.isPending;

  function run(action: Action, reason: string) {
    const variables = { id: account.accountId, data: { reason } };
    const callbacks = {
      onSuccess: () => {
        setMessage(t('done'));
        onDone();
      },
      onError: (e: unknown) => {
        // RBAC-06 : une action sensible demande une ré-authentification récente.
        if (
          reauth.handleError(e, () => {
            run(action, reason);
          })
        )
          return;
        setMessage(te(adminErrorKey(e)));
      },
    };
    setMessage(null);
    const mutations = {
      suspend,
      reactivate,
      forceLogout,
      totpReset,
      restorePublication: restore,
    } as const;
    mutations[action].mutate(variables, callbacks);
  }

  function onRole(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const role = text(form, 'role') as AccountRole;
    const reason = text(form, 'reason').trim();
    const attempt = () => {
      changeRole.mutate(
        { id: account.accountId, data: { role, reason } },
        {
          onSuccess: () => {
            setMessage(t('done'));
            onDone();
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
    <div className="flex flex-col gap-6 border-t border-border pt-6">
      <ReasonActions
        pending={pending}
        actions={[
          account.status === 'SUSPENDED'
            ? { key: 'reactivate', label: t('reactivate') }
            : { key: 'suspend', label: t('suspend'), variant: 'danger' },
          { key: 'forceLogout', label: t('forceLogout') },
          ...(account.totpEnabled ? [{ key: 'totpReset', label: t('totpReset') }] : []),
          ...(account.publicationSuspended
            ? [{ key: 'restorePublication', label: t('restorePublication') }]
            : []),
        ]}
        onAction={(key, reason) => {
          run(key as Action, reason);
        }}
      />
      <form className="flex flex-col gap-2 rounded-xl bg-surface-muted p-4" onSubmit={onRole}>
        <Label htmlFor={roleId}>{t('role')}</Label>
        <select
          id={roleId}
          name="role"
          defaultValue={account.role}
          className="min-h-touch rounded-md border border-border-strong bg-surface px-3"
        >
          {Object.values(AccountRole).map((role) => (
            <option key={role} value={role}>
              {t(`roles.${role}`)}
            </option>
          ))}
        </select>
        <Field
          label={ta('reason')}
          hint={ta('reasonHint')}
          name="reason"
          required
          minLength={10}
          maxLength={500}
        />
        <div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {t('changeRole')}
          </Button>
        </div>
      </form>
      {message ? <p role="status">{message}</p> : null}
      {reauth.dialog}
    </div>
  );
}

/** ADM-04, ADM-06 à ADM-10, RBAC-07 : recherche par adresse exacte, métadonnées, actions. */
export function AccountAdministration() {
  const t = useTranslations('admin.accounts');
  const te = useTranslations('admin.errors');
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const search = useSearchAccount({ email }, { query: { enabled: email.length > 0 } });

  function onSearch(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setEmail(text(new FormData(event.currentTarget), 'email').trim());
  }

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getSearchAccountQueryKey({ email }) });
  };

  return (
    <div className="flex flex-col gap-6">
      <form role="search" className="flex flex-wrap items-end gap-2" onSubmit={onSearch}>
        <div className="min-w-0 flex-1">
          <Field label={t('email')} name="email" type="email" required maxLength={254} />
        </div>
        <Button type="submit">{t('search')}</Button>
      </form>
      {search.error ? (
        <p role="alert" className="text-sm text-danger">
          {te(adminErrorKey(search.error))}
        </p>
      ) : null}
      {search.data ? (
        search.data.account ? (
          <section className="flex flex-col gap-6 rounded-xl border border-border bg-surface p-5 shadow-sm">
            <Metadata account={search.data.account} />
            <Actions account={search.data.account} onDone={refresh} />
          </section>
        ) : (
          <EmptyState compact title={t('notFound')} />
        )
      ) : null}
    </div>
  );
}
