import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/features/auth/auth-shell';
import { TokenConfirm } from '@/features/auth/token-confirm';

export default async function Page() {
  const t = await getTranslations('auth');
  return (
    <AuthShell
      title={t('totpReset.title')}
      description={t('totpReset.who')}
      footer={
        <>
          <Link href="/auth/login" className="underline">
            {t('links.login')}
          </Link>
        </>
      }
    >
      <TokenConfirm kind="totpReset" />
    </AuthShell>
  );
}
