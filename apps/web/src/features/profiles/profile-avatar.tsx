/** Luminance relative approchée d'une couleur `#rrggbb` (0 à 1) ; 0.5 si le format est inconnu. */
export function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) return 0.5;
  const n = parseInt(match[1], 16);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** Initiales sur la couleur d'accent du profil (l'avatar par image arrive en phase 2). */
export function ProfileAvatar({
  name,
  color,
  size = 56,
}: {
  name: string;
  color: string;
  size?: number;
}) {
  const initials = name.trim().slice(0, 2).toUpperCase() || '?';
  const dark = luminance(color) < 0.4;
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        color: dark ? '#ffffff' : '#141210',
      }}
    >
      {initials}
    </span>
  );
}
