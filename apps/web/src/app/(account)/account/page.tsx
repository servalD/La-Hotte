import { getTranslations } from 'next-intl/server';
import { AgeAttestation } from '@/features/account/age-attestation';
import { AccountDeletionSection } from '@/features/account/account-deletion';
import { CredentialsSection } from '@/features/account/credentials-section';

export default async function Page() {
  const t = await getTranslations('accountPage');
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-foreground-muted">{t('who')}</p>
      </header>
      <CredentialsSection />
      <AgeAttestation />
      <AccountDeletionSection />
    </>
  );
}
