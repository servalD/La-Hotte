import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/features/auth/auth-shell';
import { SecondFactorForm } from '@/features/auth/second-factor-form';

export default async function Page() {
  const [t, ta] = await Promise.all([getTranslations('secondFactor'), getTranslations('auth')]);
  return (
    <AuthShell
      title={t('title')}
      description={t('who')}
      footer={
        <Link href="/auth/login" className="underline">
          {ta('links.login')}
        </Link>
      }
    >
      <SecondFactorForm />
    </AuthShell>
  );
}
