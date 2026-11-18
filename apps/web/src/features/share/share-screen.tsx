'use client';

import { ListScope, useListLists } from '@wishlist/api-client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/** Premier lien `https://` d'un texte partagé (une application de marchand met souvent l'URL là). */
export function sharedLink(params: { url?: string | null; text?: string | null }): string | null {
  for (const candidate of [params.url, params.text]) {
    const match = candidate ? /https?:\/\/[^\s]+/i.exec(candidate) : null;
    if (match) {
      try {
        const url = new URL(match[0]);
        if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString();
      } catch {
        // Lien illisible : on passe au suivant.
      }
    }
  }
  return null;
}

/**
 * PWA-02 : « Partager → La Hotte » ouvre l'ajout de souhait avec le lien prérempli ; on choisit
 * seulement la liste (parcours clé en deux gestes, UX-05). Le lien n'est jamais suivi ici : il
 * part à l'extraction par l'API, dans la liste choisie.
 */
export function ShareScreen() {
  const t = useTranslations('share');
  const search = useSearchParams();
  const link = sharedLink({ url: search.get('url'), text: search.get('text') });
  const { data } = useListLists({ scope: ListScope.active });
  const lists = (data?.items ?? []).filter((list) => list.view !== 'teaser' && list.myRole);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold">{t('title')}</h1>
      {link ? (
        <p className="text-sm break-all text-foreground-muted">{link}</p>
      ) : (
        <p className="text-sm">{t('noLink')}</p>
      )}
      <h2 className="font-medium">{t('chooseList')}</h2>
      {lists.length === 0 ? <p>{t('noList')}</p> : null}
      <ul className="flex flex-col gap-2">
        {lists.map((list) => (
          <li key={list.id}>
            <Button asChild variant="secondary" className="w-full justify-start">
              <Link href={`/lists/${list.id}${link ? `?add=${encodeURIComponent(link)}` : ''}`}>
                {list.view !== 'teaser' && list.personal
                  ? t('personal')
                  : list.view !== 'teaser'
                    ? list.title
                    : ''}
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
