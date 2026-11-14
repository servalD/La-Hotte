import { ProfilesSection } from '@/features/account/profiles-section';
import { IncomingTransfers } from '@/features/account/incoming-transfers';
import { ProposalsSection } from '@/features/account/proposals-section';

export default function Page() {
  return (
    <>
      <ProfilesSection />
      <ProposalsSection />
      <IncomingTransfers />
    </>
  );
}
