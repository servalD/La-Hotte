'use client';

import { getGetImageUrl } from '@wishlist/api-client';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { loadImage } from './image-cache';
import { useIsOnline, useOffline } from './offline-provider';

/**
 * Image d'une fiche (EXT-47) lue par le coffre du profil (OFF-08) : disponible hors ligne, et
 * jamais dans un cache commun à l'appareil. Sans coffre (appareil partagé), l'image vient de l'API.
 */
export function ProfileImage({
  imageKey,
  className,
  width,
  height,
}: {
  imageKey: string;
  className?: string;
  width: number;
  height: number;
}) {
  const { vault } = useOffline();
  const online = useIsOnline();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!vault) return undefined;
    let alive = true;
    let url: string | null = null;
    void loadImage(vault, imageKey, { online })
      .then((blob) => {
        if (!alive || !blob) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [vault, imageKey, online]);

  const shown = vault ? src : getGetImageUrl(imageKey);
  if (!shown) {
    return <div aria-hidden="true" className={cn('bg-surface-muted', className)} />;
  }
  return (
    // EXT-47 : image servie par notre API ou le coffre ; pas d'optimisation de Next.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={shown} alt="" width={width} height={height} className={className} />
  );
}
