/** Erreur d'un formulaire entier, annoncée aux lecteurs d'écran. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-danger p-3 text-sm text-danger">
      {message}
    </p>
  );
}
