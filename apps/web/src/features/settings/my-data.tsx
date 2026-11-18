'use client';

import { ApiError, downloadProfileExport, useRequestProfileExport } from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useReauth } from '@/features/account/reauth';

const KNOWN = new Set(['EXPORT_RATE_LIMITED', 'EXPORT_NOT_FOUND']);

/**
 * RGPD-04, RGPD-11 : export des données du profil actif, après ré-authentification. Le fichier
 * est remis au navigateur tel quel, une seule fois ; rien n'en est gardé sur l'appareil.
 */
export function MyDataSection() {
  const t = useTranslations('myData');
  const reauth = useReauth();
  const request = useRequestProfileExport();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const explain = (e: unknown) => {
    const code = e instanceof ApiError ? e.problem.code : '';
    setMessage(t(KNOWN.has(code) ? code : 'generic'));
  };

  async function download(id: string) {
    setBusy(true);
    try {
      const document = await downloadProfileExport(id);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }),
      );
      const link = window.document.createElement('a');
      link.href = url;
      link.download = 'la-hotte-export.json';
      link.click();
      URL.revokeObjectURL(url);
      setMessage(t('downloaded'));
    } catch (e) {
      explain(e);
    } finally {
      setBusy(false);
    }
  }

  function start() {
    setMessage(null);
    request.mutate(undefined, {
      onSuccess: (created) => {
        void download(created.id);
      },
      onError: (e) => {
        if (reauth.handleError(e, start)) return;
        explain(e);
      },
    });
  }

  return (
    <section aria-labelledby="my-data-title" className="flex flex-col gap-3">
      <h2 id="my-data-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p className="text-sm text-foreground-muted">{t('who')}</p>
      <div>
        <Button variant="secondary" onClick={start} disabled={request.isPending || busy}>
          {t('request')}
        </Button>
      </div>
      {message ? <p role="status">{message}</p> : null}
      {reauth.dialog}
    </section>
  );
}
