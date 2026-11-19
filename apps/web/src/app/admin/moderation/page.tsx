import { getTranslations } from 'next-intl/server';
import { ModerationQueue } from '@/features/admin/moderation-queue';

export default async function Page() {
  const t = await getTranslations('admin.moderation');
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-foreground-muted">{t('who')}</p>
      </header>
      <ModerationQueue />
    </>
  );
}
