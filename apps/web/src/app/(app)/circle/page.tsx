import { getTranslations } from 'next-intl/server';
import { CircleScreen } from '@/features/circle/circle-screen';

export default async function Page() {
  const t = await getTranslations('circle');
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-foreground-muted">{t('who')}</p>
      </header>
      <CircleScreen />
    </>
  );
}
