import { getTranslations } from 'next-intl/server';
import { JoinEvent } from '@/features/events/join-event';

export default async function Page() {
  const t = await getTranslations('events.join');
  return (
    <>
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <JoinEvent />
    </>
  );
}
