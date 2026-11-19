import { getTranslations } from 'next-intl/server';
import { PlatformSettings } from '@/features/admin/platform-settings';

export default async function Page() {
  const t = await getTranslations('admin.settings');
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-foreground-muted">{t('who')}</p>
      </header>
      <PlatformSettings />
    </>
  );
}
