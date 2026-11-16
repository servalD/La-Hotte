import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import {
  type EventDetailView,
  type EventProgressView,
  getGetEventProgressQueryKey,
  getGetOneEventQueryKey,
  getListEventLinksQueryKey,
  getListListsQueryKey,
} from '@wishlist/api-client';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import fr from '../../../messages/fr.json';
import { EventScreen } from './event-screen';
import { formatDay } from './format';

// EVT-08, EVT-30, EVT-31 : la page montre ce que l'API rend ; l'avancement n'apparaît que s'il
// porte sur des listes vues en offreur (le serveur en décide, EVT-37).

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const ID = '0190a000-0000-7000-8000-000000000001';

function wrap(ui: ReactNode, seed: (client: QueryClient) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  seed(client);
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Europe/Paris">
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

const none = {
  edit: false,
  delete: false,
  cancel: false,
  invite: false,
  createLink: false,
  manageLinks: false,
  addHonoree: false,
  respond: false,
  recreate: false,
};

const base: EventDetailView = {
  id: ID,
  title: 'Les 40 ans',
  date: '2027-06-01',
  timezone: 'Europe/Paris',
  place: '',
  description: '',
  type: 'BIRTHDAY',
  mode: 'HONOREE',
  isSurprise: true,
  suggestedBudgetMinor: null,
  currency: 'EUR',
  status: 'UPCOMING',
  datePassed: false,
  myRole: 'ORGANIZER',
  myRsvp: 'YES',
  iAmHonoree: false,
  version: 1,
  permissions: { ...none, invite: true, manageLinks: true, createLink: true, respond: true },
  participants: [
    {
      profileId: 'p1',
      displayName: 'Léa',
      avatar: null,
      accentColor: '#336699',
      role: 'ORGANIZER',
      isHonoree: false,
      rsvp: 'YES',
    },
  ],
  surpriseHonorees: [
    { profileId: 'h1', displayName: 'Paul', avatar: null, accentColor: '#996633' },
  ],
  sharedAccountWarning: true,
};

function seedAll(event: EventDetailView, progress: EventProgressView) {
  return (client: QueryClient) => {
    client.setQueryData(getGetOneEventQueryKey(ID), event);
    client.setQueryData(getGetEventProgressQueryKey(ID), progress);
    client.setQueryData(getListListsQueryKey({ scope: 'active', eventId: ID }), { items: [] });
    client.setQueryData(getListEventLinksQueryKey(ID), { items: [] });
  };
}

describe('EventScreen', () => {
  it('surprise vue par l’organisateur : honorés, avertissement GFT-08, lien d’invitation', () => {
    wrap(
      <EventScreen id={ID} />,
      seedAll(base, {
        itemsTotal: 0,
        itemsWithGiver: 0,
        recipients: [],
        recipientsWithoutGiver: [],
      }),
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Les 40 ans' })).toBeInTheDocument();
    expect(screen.getByText(formatDay('2027-06-01', 'fr'), { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Surprise pour : Paul')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/code PIN/);
    expect(screen.getByRole('button', { name: 'Créer un lien' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Participe' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Aucune liste vue en offreur : pas d'avancement.
    expect(screen.queryByRole('heading', { name: 'Avancement' })).toBeNull();
  });

  it('EVT-30, EVT-31 : avancement et « qui n’a encore rien » avec les noms', () => {
    wrap(
      <EventScreen id={ID} />,
      seedAll(
        { ...base, permissions: none, sharedAccountWarning: false },
        {
          itemsTotal: 3,
          itemsWithGiver: 1,
          recipients: ['h1', 'p1'],
          recipientsWithoutGiver: ['h1'],
        },
      ),
    );
    expect(screen.getByText('Souhaits qui ont un offreur : 1 sur 3')).toBeInTheDocument();
    const nobody = screen.getByRole('heading', { name: 'Qui n’a encore rien' });
    expect(nobody.nextElementSibling).toHaveTextContent('Paul');
    expect(nobody.nextElementSibling).not.toHaveTextContent('Léa');
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Organisation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Participe' })).toBeNull();
  });
});
