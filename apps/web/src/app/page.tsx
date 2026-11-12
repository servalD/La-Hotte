import { getTranslations } from 'next-intl/server';
import { FoundationCheck } from '@/features/example/foundation-check';
import { ThemeSwitcher } from '@/features/example/theme-switcher';

export default async function HomePage() {
  const t = await getTranslations('app');
  return (
    <main id="contenu" className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('name')}</h1>
          <p className="mt-1 text-foreground-muted">{t('tagline')}</p>
        </div>
        <ThemeSwitcher />
      </header>
      <FoundationCheck />
    </main>
  );
}
