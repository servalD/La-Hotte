import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/features/auth/auth-shell';
import { ForgotPasswordForm } from '@/features/auth/forgot-password-form';

export default async function Page() {
  const t = await getTranslations('auth');
  return (
    <AuthShell
      title={t('forgot.title')}
      description={t('forgot.who')}
      footer={
        <>
          <Link href="/auth/login" className="underline">
            {t('links.login')}
          </Link>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
