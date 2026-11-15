import type { ReactNode } from 'react';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';

/** Cadre commun des écrans d'accès : titre, phrase « qui voit » (UX-04), contenu. */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main
      id="contenu"
      className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-10"
    >
      <Card className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <CardTitle className="text-2xl" id="auth-title">
            {title}
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </header>
        {children}
      </Card>
      {footer ? <nav className="flex flex-col gap-2 text-center text-sm">{footer}</nav> : null}
    </main>
  );
}
