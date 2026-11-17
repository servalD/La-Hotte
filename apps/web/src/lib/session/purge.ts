import type { QueryClient } from '@tanstack/react-query';
import { getGetSessionQueryKey } from '@wishlist/api-client';
import { forgetProfileKeys } from '@/lib/offline/keys';

const SESSION_KEY = getGetSessionQueryKey()[0];

/**
 * Efface tout ce que le navigateur sait d'un profil ou d'un compte : requêtes (hors session) et
 * mutations (PIN, mots de passe, codes de secours). À appeler à chaque changement d'identité :
 * connexion, choix de profil, verrouillage, session perdue. Les clés de requête ne portent ni le
 * profil ni le compte, donc rien ne doit survivre au passage de l'un à l'autre (OFF-20, PIN-02).
 */
export function purgeUserData(
  queryClient: QueryClient,
  options: { keepMutations?: boolean } = {},
): void {
  // OFF-21 : la clé d'un profil à PIN ne survit pas à un changement d'identité.
  forgetProfileKeys();
  if (!options.keepMutations) queryClient.getMutationCache().clear();
  void queryClient.resetQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY });
}
