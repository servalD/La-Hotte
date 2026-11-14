import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/features/auth/auth-shell';
import { OpenInvitation } from '@/features/invitations/open-invitation';

export default async function Page() {
  const t = await getTranslations('pages');
  return (
    <AuthShell title={t('invitationOpen.title')} description={t('invitationOpen.who')}>
      <OpenInvitation />
    </AuthShell>
  );
}
