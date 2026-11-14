import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/features/auth/auth-shell';
import { RegisterForm } from '@/features/auth/register-form';

export default async function Page() {
  const t = await getTranslations('auth');
  return (
    <AuthShell
      title={t('register.title')}
      description={t('register.who')}
      footer={
        <>
          <Link href="/auth/login" className="underline">
            {t('links.login')}
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}
