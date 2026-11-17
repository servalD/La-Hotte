import { OverviewScreen } from '@/features/accounting/accounting-screens';

export default async function GiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string }>;
}) {
  const { eventId } = await searchParams;
  return <OverviewScreen {...(eventId ? { eventId } : {})} />;
}
