import { encode } from 'uqr';

/**
 * QR code dessiné par le navigateur (aucun service tiers : le secret ne quitte pas la page).
 * Modules sombres sur fond clair quel que soit le thème, pour rester lisible par les applications.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { data: matrix, size } = encode(value, { ecc: 'M', border: 2 });
  const path = matrix
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : '')))
    .join('');
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="size-48 rounded-md"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#141210" />
    </svg>
  );
}
