import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/features/auth/auth-shell';
import { LoginForm } from '@/features/auth/login-form';

export default async function Page() {
  const t = await getTranslations('auth');
  return (
    <AuthShell
      title={t('login.title')}
      description={t('login.who')}
      footer={
        <>
          <Link href="/auth/forgot-password" className="underline">
            {t('links.forgot')}
          </Link>
          <Link href="/auth/register" className="underline">
            {t('links.register')}
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthShell>
  );
}
