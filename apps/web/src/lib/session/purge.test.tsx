import { QueryClient } from '@tanstack/react-query';
import { getGetSessionQueryKey } from '@wishlist/api-client';
import { describe, expect, it } from 'vitest';
import { purgeUserData } from './purge';

// OFF-20, PIN-02 : les clés de requête ne portent ni le profil ni le compte ; le changement
// d'identité doit donc tout effacer, sauf l'état de session lui-même.
describe('purgeUserData', () => {
  it('efface les données du profil précédent et garde la session', () => {
    const client = new QueryClient();
    client.setQueryData(['/api/v1/circle'], { items: [{ displayName: 'Mère' }] });
    client.setQueryData(['/api/v1/profiles/me'], { displayName: 'Mère' });
    client.setQueryData(getGetSessionQueryKey(), { authenticated: true });

    purgeUserData(client);

    expect(client.getQueryData(['/api/v1/circle'])).toBeUndefined();
    expect(client.getQueryData(['/api/v1/profiles/me'])).toBeUndefined();
    expect(client.getQueryData(getGetSessionQueryKey())).toEqual({ authenticated: true });
  });

  it('oublie les mutations : PIN, mots de passe et codes de secours ne restent pas en mémoire', async () => {
    const client = new QueryClient();
    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.resolve({ recoveryCodes: ['abcd-efgh'] }) })
      .execute({ pin: '1234' });
    expect(client.getMutationCache().getAll()).toHaveLength(1);

    purgeUserData(client);

    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });
});
