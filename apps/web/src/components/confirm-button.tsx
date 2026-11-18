'use client';

import { type ReactNode, useState } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/** Bouton qui demande confirmation avant une action destructrice (le focus revient au bouton). */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  variant = 'danger',
  disabled,
  className,
}: {
  label: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  variant?: ButtonProps['variant'];
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} disabled={disabled} className={className}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="mb-4">{description}</DialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">{cancelLabel}</Button>
          </DialogClose>
          <Button
            variant={variant}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Confirmation pilotée de l'extérieur (ouverte depuis un menu) ; même contenu que `ConfirmButton`. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  variant = 'danger',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  variant?: ButtonProps['variant'];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="mb-4">{description}</DialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">{cancelLabel}</Button>
          </DialogClose>
          <Button
            variant={variant}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
