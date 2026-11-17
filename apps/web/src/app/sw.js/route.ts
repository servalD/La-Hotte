import { SERVICE_WORKER_SOURCE } from '@/lib/pwa/service-worker-source';

// PWA-07, OFF-01, OFF-24 (ADR 0020) : service worker servi par une route statique, rendue au
// build : sa version change à chaque build, ce qui déclenche la mise à jour (PWA-06).
export const dynamic = 'force-static';

const VERSION = process.env.NEXT_PUBLIC_RELEASE ?? String(Date.now());

export function GET(): Response {
  return new Response(SERVICE_WORKER_SOURCE.replace('__LH_VERSION__', VERSION), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // Le navigateur revérifie le service worker à chaque visite.
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/',
    },
  });
}
