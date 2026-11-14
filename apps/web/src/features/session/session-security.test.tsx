import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { useGetCircle } from '@wishlist/api-client';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import fr from '../../../messages/fr.json';
import { SessionGate } from './session-gate';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

const fetchMock = vi.fn();

const PROFILE = {
  id: '0190f3c2-0000-7000-8000-000000000010',
  displayName: 'Mère',
  avatar: null,
  accentColor: '#2f6f4f',
  birthday: null,
  locale: 'fr',
  currency: 'EUR',
  timezone: 'Europe/Paris',
  isChild: false,
  hasPin: true,
  pinRelock: 'EVERY_OPEN',
  pinResetNoticeAt: null,
  childNoticeAt: null,
  email: null,
  version: 1,
};

const sessionOf = (activeProfileId: string, profileUnlocked = true) => ({
  authenticated: true,
  csrfToken: 'x',
  secondFactorPending: false,
  session: {
    id: '0190f3c2-0000-7000-8000-000000000001',
    activeProfileId,
    profileUnlocked,
    expiresAt: '2030-01-01T00:00:00Z',
  },
});

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

function wrap(ui: ReactNode, client: QueryClient) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Europe/Paris">
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cloisonnement du cache par identité (OFF-20, PIN-02)', () => {
  it('un autre profil actif efface les données du précédent', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let current = sessionOf('0190f3c2-0000-7000-8000-00000000000a');
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/api/v1/session') ? json(current) : json({}),
    );
    wrap(
      <SessionGate requires="profile">
        <p>contenu</p>
      </SessionGate>,
      client,
    );
    await screen.findByText('contenu');
    // La mère a chargé son cercle et ses invitations.
    client.setQueryData(['/api/v1/circle'], { items: [{ displayName: 'Tante Anne' }] });
    client.setQueryData(['/api/v1/invitations'], { items: [{ id: 'x' }] });

    // L'enfant choisit son profil sur le même appareil.
    current = sessionOf('0190f3c2-0000-7000-8000-00000000000b');
    await client.invalidateQueries({ queryKey: ['/api/v1/session'] });

    await waitFor(() => {
      expect(client.getQueryData(['/api/v1/circle'])).toBeUndefined();
    });
    expect(client.getQueryData(['/api/v1/invitations'])).toBeUndefined();
  });

  it('le verrouillage efface aussi les données du profil', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let current = sessionOf('0190f3c2-0000-7000-8000-00000000000a', true);
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/api/v1/session') ? json(current) : json({}),
    );
    wrap(
      <SessionGate requires="session">
        <p>contenu</p>
      </SessionGate>,
      client,
    );
    await screen.findByText('contenu');
    client.setQueryData(['/api/v1/profiles/me'], PROFILE);

    current = sessionOf('0190f3c2-0000-7000-8000-00000000000a', false);
    await client.invalidateQueries({ queryKey: ['/api/v1/session'] });

    await waitFor(() => {
      expect(client.getQueryData(['/api/v1/profiles/me'])).toBeUndefined();
    });
  });
});

describe('démarrage d’un profil (PIN-07)', () => {
  it('à chaque ouverture : le verrou précède toute lecture, aucun écran n’est monté', async () => {
    const { ProfileBoot: Boot } = await import('./profile-boot');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const reads: string[] = [];
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const path = url;
      if (path.endsWith('/api/v1/profiles/me')) return json(PROFILE);
      if (path.endsWith('/api/v1/session/lock'))
        return Promise.resolve(new Response(null, { status: 204 }));
      if (path.endsWith('/api/v1/session')) return json(sessionOf('p', false));
      reads.push(`${init?.method ?? 'GET'} ${path}`);
      return json({ items: [] });
    });
    const Child = () => {
      useGetCircle();
      return <p>cercle affiché</p>;
    };
    wrap(
      <Boot>
        <Child />
      </Boot>,
      client,
    );
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => (u as string).endsWith('/session/lock'))).toBe(
        true,
      );
    });
    expect(screen.queryByText('cercle affiché')).toBeNull();
    expect(reads).toEqual([]);
  });

  it('profil illisible : rien n’est affiché (échec fermé)', async () => {
    const { ProfileBoot: Boot } = await import('./profile-boot');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    fetchMock.mockImplementation(() =>
      json({ type: 'x', title: 'x', status: 500, code: 'INTERNAL' }, 500),
    );
    wrap(
      <Boot>
        <p>cercle affiché</p>
      </Boot>,
      client,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de vérifier ce profil');
    expect(screen.queryByText('cercle affiché')).toBeNull();
  });

  it('sans verrou demandé, les écrans sont montés', async () => {
    const { ProfileBoot: Boot } = await import('./profile-boot');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    fetchMock.mockImplementation(() => json({ ...PROFILE, pinRelock: 'NEVER' }));
    wrap(
      <Boot>
        <p>cercle affiché</p>
      </Boot>,
      client,
    );
    expect(await screen.findByText('cercle affiché')).toBeInTheDocument();
  });
});
