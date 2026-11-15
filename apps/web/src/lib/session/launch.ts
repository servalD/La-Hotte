// Une ouverture de l'application = un chargement de page (PIN-07, ADR 0013). Le verrouillage au
// lancement ne vaut que pour un profil trouvé déjà déverrouillé à l'ouverture : un PIN saisi depuis
// ce chargement compte comme l'entrée, pas comme une ouverture à reverrouiller.
let handled = false;

export function launchHandled(): boolean {
  return handled;
}

export function markLaunchHandled(): void {
  handled = true;
}
