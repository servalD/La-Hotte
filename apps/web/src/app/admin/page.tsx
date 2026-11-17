import { getTranslations } from 'next-intl/server';
import { AdminStats } from '@/features/admin/admin-stats';

export default async function Page() {
  const t = await getTranslations('admin.stats');
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-foreground-muted">{t('who')}</p>
      </header>
      <AdminStats />
    </>
  );
}
