import { ImageResponse } from 'next/og';

// PWA-01 : icônes de l'application (logo DS-05), rendues au build.
export const dynamic = 'force-static';

const ICONS = {
  'icon-192.png': { size: 192, maskable: false },
  'icon-512.png': { size: 512, maskable: false },
  'maskable-512.png': { size: 512, maskable: true },
} as const;

export function generateStaticParams(): { name: string }[] {
  return Object.keys(ICONS).map((name) => ({ name }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name } = await params;
  const icon = ICONS[name as keyof typeof ICONS] as (typeof ICONS)[keyof typeof ICONS] | undefined;
  if (!icon) return new Response(null, { status: 404 });
  const { size, maskable } = icon;
  // Une icône masquable garde son motif dans la zone sûre (80 % du centre).
  const glyph = Math.round(size * (maskable ? 0.5 : 0.66));
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#9f1239',
        borderRadius: maskable ? 0 : size * 0.22,
      }}
    >
      {/* Le logo de l'application (BrandMark), aux couleurs des jetons : hotte claire, lien et étincelle dorés. */}
      <svg width={glyph} height={glyph} viewBox="0 0 32 32">
        <path
          d="M11 9c0-2.2 2.2-3.5 5-3.5s5 1.3 5 3.5l3.2 3.6c2.3 5.2 1.6 11.4-3.4 14.2-3 1.7-7 1.7-10 0-5-2.8-5.7-9-3.4-14.2L11 9Z"
          fill="#fbf7f0"
        />
        <path
          d="M10.5 10.5c3.5 1.8 7.5 1.8 11 0"
          fill="none"
          stroke="#f2b84b"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path d="M24.5 3.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z" fill="#f2b84b" />
      </svg>
    </div>,
    { width: size, height: size },
  );
}
