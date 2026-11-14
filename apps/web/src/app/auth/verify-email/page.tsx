import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/features/auth/auth-shell';
import { TokenConfirm } from '@/features/auth/token-confirm';

export default async function Page() {
  const t = await getTranslations('auth');
  return (
    <AuthShell
      title={t('verifyEmail.title')}
      description={t('verifyEmail.who')}
      footer={
        <>
          <Link href="/auth/login" className="underline">
            {t('links.login')}
          </Link>
        </>
      }
    >
      <TokenConfirm kind="verifyEmail" />
    </AuthShell>
  );
}
