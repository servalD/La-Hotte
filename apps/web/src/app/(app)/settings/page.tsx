import { getTranslations } from 'next-intl/server';
import { NotificationPreferencesSection } from '@/features/notifications/preferences-section';
import { OwnTransfer } from '@/features/settings/own-transfer';
import { PinEmailSection } from '@/features/settings/pin-email-section';
import { SettingsForm } from '@/features/settings/settings-form';

export default async function Page() {
  const t = await getTranslations('settings');
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 id="settings-title" className="text-2xl font-bold">
          {t('title')}
        </h1>
        <p className="text-sm text-foreground-muted">{t('who')}</p>
      </header>
      <OwnTransfer />
      <SettingsForm />
      <PinEmailSection />
      <NotificationPreferencesSection />
    </>
  );
}
