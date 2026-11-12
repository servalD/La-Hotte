'use client';

import {
  ApiError,
  type ExampleItemRecipientView,
  type ExamplePriority,
  useCreateExampleItem,
  useGetExampleItem,
} from '@wishlist/api-client';
import { exampleItemsSchemas } from '@wishlist/api-client/zod';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMotionPreset } from '@/lib/motion/presets';

const PRIORITIES: ExamplePriority[] = ['low', 'normal', 'high'];

type FieldErrors = Partial<Record<'title' | 'priority', string>>;

/**
 * Essai du socle (sortie de phase 0) : formulaire validé par le Zod généré, envoi par le hook
 * généré, erreurs du serveur affichées par champ, relecture par la route polymorphe.
 * À supprimer avec le module `example` de l'API.
 */
export function FoundationCheck() {
  const t = useTranslations('foundation');
  const ids = { title: useId(), titleHint: useId(), titleError: useId(), priority: useId() };
  const appear = useMotionPreset('appear');

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [created, setCreated] = useState<ExampleItemRecipientView | null>(null);
  const create = useCreateExampleItem();
  const reloaded = useGetExampleItem(created?.id ?? '', { query: { enabled: created !== null } });

  function onSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = form.get('title');
    const parsed = exampleItemsSchemas.createExampleItemBody.safeParse({
      title: typeof title === 'string' ? title.trim() : '',
      priority: form.get('priority'),
    });
    if (!parsed.success) {
      const tooLong = parsed.error.issues.some(
        (i) => i.path[0] === 'title' && i.code === 'too_big',
      );
      setFieldErrors({ title: t(tooLong ? 'errors.titleTooLong' : 'errors.titleRequired') });
      return;
    }
    setFieldErrors({});
    create.mutate(
      { data: parsed.data },
      {
        onSuccess: (view) => {
          setCreated(view);
        },
        onError: (error) => {
          // Le serveur reste l'autorité (API-03) : ses erreurs s'affichent par champ.
          const titleError = error.problem.errors?.find((e) => e.field === 'title');
          if (titleError) setFieldErrors({ title: t('errors.titleRequired') });
        },
      },
    );
  }

  const globalError =
    create.error && !fieldErrors.title
      ? create.error instanceof ApiError
        ? t('errors.generic', { code: create.error.problem.code })
        : t('errors.network')
      : null;

  return (
    <Card aria-labelledby="foundation-title">
      <CardTitle id="foundation-title">{t('title')}</CardTitle>
      <CardDescription className="mt-1">{t('description')}</CardDescription>
      {/* UX-04 : toujours dire qui voit. */}
      <p className="mt-3 text-sm font-medium">{t('whoSees')}</p>

      <form className="mt-6 flex flex-col gap-4" noValidate onSubmit={onSubmit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.title}>{t('titleLabel')}</Label>
          <Input
            id={ids.title}
            name="title"
            maxLength={120}
            aria-invalid={fieldErrors.title ? true : undefined}
            aria-describedby={
              fieldErrors.title ? `${ids.titleHint} ${ids.titleError}` : ids.titleHint
            }
          />
          <p id={ids.titleHint} className="text-xs text-foreground-muted">
            {t('titleHint')}
          </p>
          {fieldErrors.title ? (
            <p id={ids.titleError} className="text-sm text-danger">
              {fieldErrors.title}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.priority}>{t('priorityLabel')}</Label>
          <select
            id={ids.priority}
            name="priority"
            defaultValue="normal"
            className="h-touch rounded-md border border-border-strong bg-surface px-2"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`priority.${p}`)}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" disabled={create.isPending} className="self-start">
          {create.isPending ? t('submitting') : t('submit')}
        </Button>
      </form>

      {/* A11Y-04 : résultat annoncé poliment, sans voler le focus. */}
      <div aria-live="polite" className="mt-4 min-h-6 text-sm">
        <AnimatePresence mode="wait">
          {globalError ? (
            <motion.p
              key="error"
              className="text-danger"
              variants={appear}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {globalError}
            </motion.p>
          ) : created ? (
            <motion.div
              key={created.id}
              variants={appear}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <p>
                {t('created', {
                  title: created.title,
                  priority: t(`priority.${created.priority}`),
                })}
              </p>
              {reloaded.data ? (
                <p className="text-foreground-muted">
                  {t('reloaded', { view: reloaded.data.view })}
                </p>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </Card>
  );
}
