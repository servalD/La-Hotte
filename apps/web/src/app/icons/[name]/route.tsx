import { ImageResponse } from 'next/og';

// PWA-01 : icônes provisoires (identité visuelle à décider, `10` question 1), rendues au build.
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
  const glyph = Math.round(size * (maskable ? 0.42 : 0.56));
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#9a3b2f',
        borderRadius: maskable ? 0 : size * 0.22,
        color: '#fcfbf9',
        fontSize: glyph,
        fontWeight: 700,
      }}
    >
      LH
    </div>,
    { width: size, height: size },
  );
}
