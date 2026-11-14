import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/features/auth/auth-shell';
import { AccountSetupForm } from '@/features/auth/account-setup-form';

export default async function Page() {
  const t = await getTranslations('pages');
  return (
    <AuthShell title={t('accountSetup.title')} description={t('accountSetup.who')}>
      <AccountSetupForm />
    </AuthShell>
  );
}
