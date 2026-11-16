import { EventScreen } from '@/features/events/event-screen';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventScreen id={id} />;
}
