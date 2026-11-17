'use client';

import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/features/auth/field';
import { text } from '@/features/auth/form-data';

export interface ReasonAction {
  readonly key: string;
  readonly label: string;
  readonly variant?: 'primary' | 'secondary' | 'danger';
}

/**
 * RBAC-06 : une action d'administration se fait avec un motif, écrit au journal d'audit. Un
 * formulaire, plusieurs boutons : celui qui est pressé décide de l'action.
 */
export function ReasonActions({
  actions,
  pending,
  onAction,
}: {
  actions: readonly ReasonAction[];
  pending: boolean;
  onAction: (key: string, reason: string) => void;
}) {
  const t = useTranslations('admin');
  const formId = useId();
  const [chosen, setChosen] = useState<string | null>(null);

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const submitter = event.nativeEvent.submitter as HTMLButtonElement | null;
    const key = submitter?.value ?? chosen;
    if (!key) return;
    onAction(key, text(new FormData(event.currentTarget), 'reason').trim());
  }

  return (
    <form id={formId} className="flex flex-col gap-2" onSubmit={submit}>
      <Field
        label={t('reason')}
        hint={t('reasonHint')}
        name="reason"
        required
        minLength={10}
        maxLength={500}
      />
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.key}
            type="submit"
            name="action"
            value={action.key}
            variant={action.variant ?? 'secondary'}
            disabled={pending}
            onClick={() => {
              setChosen(action.key);
            }}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </form>
  );
}
