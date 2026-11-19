import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';

// PWA-07 : page d'enveloppe sans aucune donnée, servie hors ligne pour une page jamais ouverte
// sur cet appareil. UX-06 : jamais d'impasse, elle propose la suite.
export default async function OfflinePage() {
  const t = await getTranslations('offline');
  return (
    <main
      id="contenu"
      className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6"
    >
      <h1 className="text-3xl font-semibold">{t('title')}</h1>
      <p>{t('body')}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/lists">{t('lists')}</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/cart">{t('cart')}</Link>
        </Button>
      </div>
    </main>
  );
}
