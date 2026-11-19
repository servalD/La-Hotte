import type { ComponentProps } from 'react';

/** Pictogrammes de l'interface (DS-02) : traits de 1,75 px, décoratifs (le libellé est toujours à côté). */
function Icon({ children, ...props }: ComponentProps<'svg'>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v9.5h13V10" />
      <path d="M10 19.5v-5h4v5" />
    </Icon>
  );
}

export function ListIcon(props: ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <path d="m3.5 6.5.9.9 1.7-1.8M3.5 12l.9.9 1.7-1.8M3.5 17.5l.9.9 1.7-1.8" />
    </Icon>
  );
}

export function CalendarIcon(props: ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Icon>
  );
}

export function BasketIcon(props: ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <path d="M3 9.5h18l-1.8 9a2 2 0 0 1-2 1.6H6.8a2 2 0 0 1-2-1.6L3 9.5Z" />
      <path d="m8 9.5 3-5.5M16 9.5 13 4" />
    </Icon>
  );
}

export function BellIcon(props: ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <path d="M6 17.5V11a6 6 0 1 1 12 0v6.5l1.5 1.5h-15L6 17.5Z" />
      <path d="M10 21.5h4" />
    </Icon>
  );
}

export function ChevronDownIcon(props: ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function SparkleIcon(props: ComponentProps<'svg'>) {
  return (
    <Icon {...props} fill="currentColor" strokeWidth="0">
      <path d="M12 2.5c.5 4.6 2.9 7 7.5 7.5-4.6.5-7 2.9-7.5 7.5-.5-4.6-2.9-7-7.5-7.5 4.6-.5 7-2.9 7.5-7.5Z" />
    </Icon>
  );
}

export function UserIcon(props: ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M4.5 20c.7-3.6 3.5-5.5 7.5-5.5s6.8 1.9 7.5 5.5" />
    </Icon>
  );
}

export function GiftIcon(props: ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="8.5" width="17" height="4" rx="1" />
      <path d="M5 12.5V20h14v-7.5M12 8.5V20" />
      <path d="M12 8.5c-1.5-4-5.5-4.5-5.5-2s3 2.5 5.5 2Zm0 0c1.5-4 5.5-4.5 5.5-2s-3 2.5-5.5 2Z" />
    </Icon>
  );
}

export function ShieldIcon(props: ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6L12 3Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </Icon>
  );
}

export function UsersIcon(props: ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M2.8 19.5c.6-3.3 3-5 6.2-5s5.6 1.7 6.2 5" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 5.8M18 14.8c1.8.6 2.9 2.1 3.2 4.7" />
    </Icon>
  );
}

export function ChevronRightIcon(props: ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  );
}

export function PlusIcon(props: ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function WalletIcon(props: ComponentProps<'svg'>) {
  return (
    <Icon {...props}>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" />
      <rect x="3.5" y="8" width="17" height="11.5" rx="2.5" />
      <path d="M16 13.5h4.5" />
      <circle cx="16" cy="13.5" r=".6" fill="currentColor" />
    </Icon>
  );
}

export function MoreIcon(props: ComponentProps<'svg'>) {
  return (
    <Icon {...props} fill="currentColor" strokeWidth="0">
      <circle cx="5.5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="18.5" cy="12" r="1.75" />
    </Icon>
  );
}

/** Logo de La Hotte : une hotte rouge, son lien doré et une étincelle. Décoratif, le nom est à côté. */
export function BrandMark({ size = 22, ...props }: ComponentProps<'svg'> & { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path
        d="M11 9c0-2.2 2.2-3.5 5-3.500s5 1.3 5 3.500l3.2 3.600c2.300 5.2 1.6 11.400-3.400 14.200-3 1.700-7 1.700-10 0-5-2.800-5.700-9-3.400-14.200L11 9Z"
        fill="var(--ds-color-primary)"
      />
      <path
        d="M10.500 10.500c3.5 1.800 7.500 1.800 11 0"
        fill="none"
        stroke="var(--ds-color-accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M24.500 3.500l.9 2.100 2.100.9-2.100.9-.9 2.100-.9-2.100-2.100-.9 2.100-.9.9-2.100Z"
        fill="var(--ds-color-accent)"
      />
    </svg>
  );
}
