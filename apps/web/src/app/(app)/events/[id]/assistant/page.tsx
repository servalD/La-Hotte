import { getTranslations } from 'next-intl/server';
import { EventAssistant } from '@/features/events/event-assistant';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ list?: string }>;
}) {
  const { id } = await params;
  const { list } = await searchParams;
  const t = await getTranslations('events.assistant');
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-foreground-muted">{t('who')}</p>
      </header>
      <EventAssistant eventId={id} listId={list ?? null} />
    </>
  );
}
