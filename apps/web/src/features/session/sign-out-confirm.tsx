'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Déconnexion depuis un menu. OFF-22 : elle efface la file des actions en attente, l'utilisateur
 * est prévenu avant. La fenêtre vit hors du menu (qui se démonte à la sélection) : `dialog` se
 * place à côté du menu, `request` est le `onSelect` de l'entrée « Se déconnecter ».
 */
export function useSignOutConfirm(
  waiting: number,
  onSignOut: () => void,
): { request: () => void; dialog: ReactNode } {
  const t = useTranslations('nav');
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>{t('signOutQueueTitle')}</DialogTitle>
        <DialogDescription className="mb-4">
          {t('signOutQueueBody', { count: waiting })}
        </DialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">{t('cancel')}</Button>
          </DialogClose>
          <Button
            variant="danger"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            {t('signOutAnyway')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false);
              router.push('/actions');
            }}
          >
            {t('actions', { count: waiting })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return {
    request: () => {
      if (waiting > 0) setOpen(true);
      else onSignOut();
    },
    dialog,
  };
}
