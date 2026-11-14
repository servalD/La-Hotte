import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/features/auth/auth-shell';
import { GoogleReturn } from '@/features/auth/google-return';

export default async function Page() {
  const t = await getTranslations('google');
  return (
    <AuthShell title={t('title')} description={t('who')}>
      <Suspense fallback={null}>
        <GoogleReturn />
      </Suspense>
    </AuthShell>
  );
}
