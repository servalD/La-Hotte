import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import fr from '../../../messages/fr.json';
import { LoginForm } from './login-form';
import { TokenConfirm } from './token-confirm';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const fetchMock = vi.fn();

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Europe/Paris">
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

const problem = (code: string, status: number) =>
  new Response(JSON.stringify({ type: 'x', title: 'x', status, code }), { status });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('connexion (AUTH-01)', () => {
  it('dit « adresse ou mot de passe incorrect » sans distinguer les deux', async () => {
    fetchMock.mockResolvedValue(problem('INVALID_CREDENTIALS', 401));
    wrap(<LoginForm />);
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'a@example.org');
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'pas-le-bon');
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Adresse ou mot de passe incorrect.',
    );
  });

  it('signale les champs vides sans appeler le serveur', async () => {
    wrap(<LoginForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findAllByRole('alert')).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('page à jeton dans le fragment (AUTH-15, AUTH-16)', () => {
  const token = 'A'.repeat(43);

  it("n'appelle pas l'API à l'ouverture et efface le jeton de l'adresse", async () => {
    window.history.replaceState(null, '', `/auth/verify-email#${token}`);
    wrap(<TokenConfirm kind="verifyEmail" />);
    expect(await screen.findByRole('button', { name: 'Confirmer mon adresse' })).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });

  it('envoie le jeton dans le corps, pas dans l’adresse, au clic', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    window.history.replaceState(null, '', `/auth/verify-email#${token}`);
    wrap(<TokenConfirm kind="verifyEmail" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmer mon adresse' }));
    // Sans cookie CSRF, le client lit d'abord GET /session (API-21), puis envoie la mutation.
    const post = () =>
      fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    await waitFor(() => {
      expect(post()).toBeDefined();
    });
    expect(
      fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toHaveLength(1);
    const [url, init] = post() as [string, RequestInit];
    expect(url).not.toContain(token);
    expect(init.body).toBe(JSON.stringify({ token }));
    expect(await screen.findByRole('status')).toHaveTextContent('Adresse confirmée');
  });

  it('propose la réinitialisation à qui ne connaît pas le compte (C3-M2)', async () => {
    window.history.replaceState(null, '', `/auth/verify-email#${token}`);
    wrap(<TokenConfirm kind="verifyEmail" />);
    expect(await screen.findByRole('link', { name: 'Réinitialisez-le.' })).toHaveAttribute(
      'href',
      '/auth/forgot-password',
    );
  });

  it('réinitialisation du TOTP : le jeton part au clic vers la bonne route (ADM-07)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    window.history.replaceState(null, '', `/auth/totp-reset#${token}`);
    wrap(<TokenConfirm kind="totpReset" />);
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Retirer la double authentification' }),
    );
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('/auth/totp/reset/confirm')),
      ).toBe(true);
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Double authentification retirée');
  });

  it('refuse un fragment qui n’est pas un jeton', async () => {
    window.history.replaceState(null, '', '/auth/cancel-email-change#nimporte-quoi');
    wrap(<TokenConfirm kind="cancelEmailChange" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce lien n’est plus valable');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
