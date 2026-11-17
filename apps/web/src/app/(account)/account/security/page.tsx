import { getTranslations } from 'next-intl/server';
import { AdminActionsSection } from '@/features/account/admin-actions-section';
import { DevicesSection } from '@/features/account/devices-section';
import { TotpSection } from '@/features/account/totp-section';

export default async function Page() {
  const t = await getTranslations('securityPage');
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-foreground-muted">{t('who')}</p>
      </header>
      <TotpSection />
      <DevicesSection />
      <AdminActionsSection />
    </>
  );
}
