/** Valeur texte d'un champ de formulaire ; vide si absent ou si ce n'est pas un texte. */
export function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
