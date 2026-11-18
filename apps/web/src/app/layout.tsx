import type { Metadata, Viewport } from 'next';
import { Fraunces, Figtree } from 'next/font/google';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ServiceWorkerUpdates } from '@/lib/pwa/service-worker';
import { Providers } from './providers';
import './globals.css';

// DS-06 : polices auto-hébergées au build, aucune requête vers un service tiers à l'exécution.
const display = Fraunces({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const body = Figtree({ subsets: ['latin'], variable: '--font-body', display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');
  return { title: t('name'), description: t('tagline') };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // PWA-11 : l'écran à encoche est occupé en entier ; les marges sûres sont tenues par le cadre.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbf7f0' },
    { media: '(prefers-color-scheme: dark)', color: '#17110f' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, nonce, t] = await Promise.all([
    getLocale(),
    headers().then((h) => h.get('x-nonce') ?? undefined),
    getTranslations('app'),
  ]);

  return (
    <html lang={locale} className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:rounded-md focus:bg-surface focus:p-3"
        >
          {t('skipToContent')}
        </a>
        <NextIntlClientProvider>
          <Providers nonce={nonce}>
            {children}
            {/* PWA-06, PWA-07 : service worker et proposition de mise à jour. */}
            <ServiceWorkerUpdates />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
