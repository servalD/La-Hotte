import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/features/auth/auth-shell';
import { ResetPasswordForm } from '@/features/auth/reset-password-form';

export default async function Page() {
  const t = await getTranslations('auth');
  return (
    <AuthShell
      title={t('reset.title')}
      description={t('reset.who')}
      footer={
        <>
          <Link href="/auth/login" className="underline">
            {t('links.login')}
          </Link>
        </>
      }
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
