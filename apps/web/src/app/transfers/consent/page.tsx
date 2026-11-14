import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/features/auth/auth-shell';
import { TransferConsentForm } from '@/features/auth/transfer-consent-form';

export default async function Page() {
  const t = await getTranslations('pages');
  return (
    <AuthShell title={t('transferConsent.title')} description={t('transferConsent.who')}>
      <TransferConsentForm />
    </AuthShell>
  );
}
