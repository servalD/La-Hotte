import { Suspense } from 'react';
import { ShareScreen } from '@/features/share/share-screen';

// PWA-02 : cible de partage du manifeste.
export default function SharePage() {
  return (
    <Suspense>
      <ShareScreen />
    </Suspense>
  );
}
