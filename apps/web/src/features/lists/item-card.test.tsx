import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ItemGiverView, ItemRecipientView, ListPermissionsView } from '@wishlist/api-client';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import fr from '../../../messages/fr.json';
import { ItemCard } from './item-card';

// LST-12, LST-16 : le destinataire voit neutre ou reçu ; l'offreur voit l'état, en pictogramme et en
// mots (jamais par la couleur seule). L'interface affiche ce que l'API rend.

function wrap(ui: ReactNode) {
  const client = new QueryClient();
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Europe/Paris">
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

const permissions: ListPermissionsView = {
  edit: false,
  archive: false,
  delete: false,
  restore: false,
  manageMembers: false,
  add: 'none',
  editRules: false,
  readLog: false,
};

const product = {
  id: 'p',
  title: 'Vélo rouge',
  description: '',
  imageKey: null,
  merchant: null,
  sourceUrl: null,
};

const base = {
  id: 'i',
  listId: 'l',
  product,
  quantity: 3,
  unitPriceMinor: 1999,
  currency: 'EUR',
  priority: 'LOVE' as const,
  note: '',
  manyWelcome: false,
  position: 0,
  hidden: false,
  mine: false,
  carriedForward: false,
  version: 1,
};

describe('ItemCard', () => {
  it('vue destinataire : aucun état d’offreur ; le reçu en mot et en pictogramme', () => {
    const item: ItemRecipientView = {
      ...base,
      view: 'recipient',
      received: true,
      receivedAt: null,
    };
    wrap(<ItemCard item={item} listId="l" permissions={permissions} isGiftlist={false} />);
    expect(screen.getByText('Reçu')).toBeInTheDocument();
    expect(screen.queryByText(/Réservé|Acheté|Suggestion/)).toBeNull();
    // Critère de 02 : 3 × 19,99 € = 59,97 €.
    expect(screen.getByText(/59,97/)).toBeInTheDocument();
  });

  it('vue offreur : état et suggestion annoncés en toutes lettres', () => {
    const item: ItemGiverView = {
      ...base,
      view: 'giver',
      visibilityMode: 'ALL',
      status: 'PURCHASED',
      isSuggestion: true,
      shownToRecipient: false,
      intendedRecipientId: null,
      addedBy: null,
      createdAt: '2026-11-15T00:00:00.000Z',
      carriedFrom: null,
    };
    wrap(<ItemCard item={item} listId="l" permissions={permissions} isGiftlist={false} />);
    expect(screen.getByText(/Acheté \(supposé reçu\)/)).toBeInTheDocument();
    expect(screen.getByText(/Suggestion : invisible du destinataire/)).toBeInTheDocument();
  });
});

describe('ItemCard : menu des actions (UX-13, VIS-20)', () => {
  const giverItem: ItemGiverView = {
    ...base,
    view: 'giver',
    visibilityMode: 'ALL',
    status: 'OPEN',
    isSuggestion: false,
    shownToRecipient: false,
    intendedRecipientId: null,
    addedBy: null,
    createdAt: '2026-11-15T00:00:00.000Z',
    carriedFrom: null,
  };

  it('vue offreur : copier est proposé, ne plus le vouloir ne l’est pas', async () => {
    wrap(<ItemCard item={giverItem} listId="l" permissions={permissions} isGiftlist={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Plus d’actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Copier dans mes fiches' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /ne le veux plus/i })).toBeNull();
  });

  it('vue destinataire : « reçu » reste visible, les gestes d’offreur n’existent pas', async () => {
    const item: ItemRecipientView = {
      ...base,
      mine: true,
      view: 'recipient',
      received: false,
      receivedAt: null,
    };
    wrap(<ItemCard item={item} listId="l" permissions={permissions} isGiftlist={false} />);
    expect(screen.getByRole('button', { name: /reçu/i })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Plus d’actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Modifier' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Copier/ })).toBeNull();
    expect(screen.queryByText(/Réservé|Acheté/)).toBeNull();
  });
});
