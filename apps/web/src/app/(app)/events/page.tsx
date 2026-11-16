import { getTranslations } from 'next-intl/server';
import { EventsScreen } from '@/features/events/events-screen';

export default async function Page() {
  const t = await getTranslations('events');
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-foreground-muted">{t('whoList')}</p>
      </header>
      <EventsScreen />
    </>
  );
}
