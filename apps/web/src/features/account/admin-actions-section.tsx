'use client';

import { useListAdminActionsOnAccount } from '@wishlist/api-client';
import { useFormatter, useTranslations } from 'next-intl';

/** AUD-03, AUD-07 : actions de l'équipe sur le compte, sans acteur ni adresse IP. */
export function AdminActionsSection() {
  const t = useTranslations('adminActions');
  const labels = useTranslations('admin.audit.actions');
  const format = useFormatter();
  const actions = useListAdminActionsOnAccount();
  return (
    <section aria-labelledby="admin-actions-title" className="flex flex-col gap-3">
      <h2 id="admin-actions-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p className="text-sm text-foreground-muted">{t('who')}</p>
      {actions.data?.items.length === 0 ? <p>{t('empty')}</p> : null}
      <ul className="flex flex-col gap-2">
        {actions.data?.items.map((item) => (
          <li key={`${item.action}-${item.at}`} className="rounded-md border border-border p-3">
            <p className="font-medium">{labels(item.action.replaceAll('.', '_'))}</p>
            <p className="text-sm text-foreground-muted">
              {format.dateTime(new Date(item.at), { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
            {item.reason ? (
              <p className="text-sm break-words">{t('reason', { reason: item.reason })}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
