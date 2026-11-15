import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/features/auth/auth-shell';
import { TokenConfirm } from '@/features/auth/token-confirm';

export default async function Page() {
  const t = await getTranslations('auth');
  return (
    <AuthShell title={t('verifyProfileEmail.title')} description={t('verifyProfileEmail.who')}>
      <TokenConfirm kind="verifyProfileEmail" />
    </AuthShell>
  );
}
