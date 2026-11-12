import { createForward, createRelay, FixedWindowLimiter, parseDsn } from '@/lib/telemetry/relay';

// Relais des erreurs du navigateur vers GlitchTip (OBS-33). Logique et tests : `lib/telemetry/relay`.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const relay = createRelay({
  // Le DSN du navigateur, inscrit au build : c'est celui que porte chaque enveloppe.
  dsn: parseDsn(process.env.NEXT_PUBLIC_SENTRY_DSN),
  limiter: new FixedWindowLimiter({
    windowMs: 60_000,
    perClient: 30,
    total: 600,
    maxClients: 10_000,
  }),
  forward: createForward(),
});

export const POST = relay;

const methodNotAllowed = (): Response =>
  new Response(null, { status: 405, headers: { Allow: 'POST' } });

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
