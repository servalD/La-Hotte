import { getTranslations } from 'next-intl/server';
import { OwnTransfer } from '@/features/settings/own-transfer';
import { SettingsTabs } from '@/features/settings/settings-tabs';

export default async function Page() {
  const t = await getTranslations('settings');
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 id="settings-title" className="text-3xl font-semibold">
          {t('title')}
        </h1>
        <p className="text-sm text-foreground-muted">{t('who')}</p>
      </header>
      <OwnTransfer />
      <SettingsTabs />
    </>
  );
}
