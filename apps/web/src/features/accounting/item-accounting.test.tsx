import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import fr from '../../../messages/fr.json';
import { CartScreen } from './accounting-screens';
import { ItemAccounting, parseAmount, ShortfallWindow } from './item-accounting';

// CPT-02, CPT-19, CPT-43, CPT-59 : l'écran montre ce que l'API rend ; l'offreur ne reçoit aucun
// montant individuel ; la fenêtre du reste coche tout le monde par défaut et dit qui saura.

const state = vi.hoisted((): { accounting: unknown; cart: unknown } => ({
  accounting: null,
  cart: null,
}));

vi.mock('@wishlist/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wishlist/api-client')>();
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    ...actual,
    useGetItemAccounting: () => ({ data: state.accounting }),
    useGetCart: () => ({ data: state.cart }),
    usePutItemContribution: mutation,
    useDeleteItemContribution: mutation,
    usePutItemPurchase: mutation,
    useDeleteItemPurchase: mutation,
    useLowerItemContribution: mutation,
    useApproveAccountingReview: mutation,
    useRefuseAccountingReview: mutation,
    usePostItemShortfallNotice: mutation,
  };
});

function wrap(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Europe/Paris">
      <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

const person = (id: string, displayName: string) => ({
  id,
  displayName,
  avatar: null,
  accentColor: '#888',
});
const common = {
  accountingId: 'a',
  itemId: 'i',
  title: 'Robot',
  currency: 'EUR',
  plannedTotalMinor: 10_000,
  itemTotalMinor: null,
  coveredMinor: 4_000,
  remainingMinor: 6_000,
  buyer: person('p', 'Papa'),
  purchased: false,
  canContribute: true,
};

describe('ItemAccounting', () => {
  it('offreur : couverture et participants, aucun montant individuel ; « Compléter »', () => {
    state.accounting = {
      view: 'giver',
      ...common,
      participants: [{ person: person('p', 'Papa'), mode: 'FIXED', rank: 1, isBuyer: true }],
    };
    wrap(<ItemAccounting itemId="i" />);
    expect(screen.getByRole('button', { name: /Compléter/ })).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Participants' });
    expect(list.textContent).toContain('Papa');
    expect(list.textContent).not.toContain('40');
    expect(screen.getByText(/jamais de son destinataire/)).toBeTruthy();
  });

  it('participant : montants, sa part, et une revue qu’il ne peut décider', () => {
    state.accounting = {
      view: 'participant',
      ...common,
      itemTotalMinor: 12_000,
      participants: [
        {
          person: person('p', 'Papa'),
          mode: 'FIXED',
          rank: 1,
          isBuyer: true,
          amountMinor: 4_000,
          units: null,
          mine: true,
        },
      ],
      mine: {
        id: 'c',
        mode: 'FIXED',
        share: null,
        units: null,
        amountMinor: 4_000,
        rank: 1,
        settlement: 'NONE',
        settledMinor: 0,
      },
      isBuyer: true,
      reviewEnabled: true,
      receiptEnabled: false,
      reviews: [
        {
          id: 'r',
          kind: 'COST',
          author: null,
          proposedTotalMinor: 12_000,
          proposedReviewEnabled: null,
          proposedReceiptEnabled: null,
          createdAt: '2026-11-17T10:00:00.000Z',
          canDecide: false,
        },
      ],
    };
    wrap(<ItemAccounting itemId="i" />);
    expect(screen.getByRole('list', { name: 'Participants' }).textContent).toContain('40,00');
    expect(screen.getByText('Prix affiché maintenant')).toBeTruthy();
    expect(screen.getByText('En attente d’un autre participant'.replace('’', "'"))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Acheté' })).toBeTruthy();
  });
});

describe('ShortfallWindow (CPT-19)', () => {
  it('tous les autres participants cochés par défaut ; le choix reste privé', () => {
    wrap(
      <ShortfallWindow
        itemId="i"
        amount="8,00 €"
        onClose={vi.fn()}
        onError={vi.fn()}
        view={{
          view: 'participant',
          ...common,
          participants: [
            {
              person: person('m', 'Mamie'),
              mode: 'FIXED',
              rank: 3,
              isBuyer: false,
              amountMinor: 1_200,
              units: null,
              mine: true,
            },
            {
              person: person('p', 'Papa'),
              mode: 'FIXED',
              rank: 1,
              isBuyer: true,
              amountMinor: 3_000,
              units: null,
              mine: false,
            },
            {
              person: person('t', 'Tonton'),
              mode: 'FIXED',
              rank: 2,
              isBuyer: false,
              amountMinor: 6_000,
              units: null,
              mine: false,
            },
          ],
          mine: null,
          isBuyer: false,
          reviewEnabled: true,
          receiptEnabled: false,
          reviews: [],
        }}
      />,
    );
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    for (const box of boxes) expect((box as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Seul vous saurez/)).toBeTruthy();
  });
});

describe('CartScreen (CPT-11)', () => {
  it('groupe par événement et destinataire, avec l’état de financement', () => {
    state.cart = {
      groups: [
        {
          event: { id: 'e', title: 'Noël' },
          recipients: [person('m', 'Marie')],
          items: [
            {
              accountingId: 'a',
              itemId: 'i',
              title: 'Robot',
              sourceUrl: 'https://example.test/robot',
              quantity: 1,
              currency: 'EUR',
              totalMinor: 10_000,
              coveredMinor: 8_000,
              remainingMinor: 2_000,
              myShareMinor: 5_000,
              purchased: false,
            },
          ],
        },
      ],
    };
    wrap(<CartScreen />);
    expect(screen.getByRole('heading', { name: /Noël · Marie/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Robot' }).getAttribute('rel')).toBe(
      'noopener noreferrer',
    );
    expect(screen.getByText(/à votre charge/)).toBeTruthy();
  });
});

describe('parseAmount', () => {
  it('unités mineures entières, jamais de flottant (invariant 4)', () => {
    expect(parseAmount('23,50')).toBe(2_350);
    expect(parseAmount('23.5')).toBe(2_350);
    expect(parseAmount('10')).toBe(1_000);
    expect(parseAmount('0,1')).toBe(10);
    expect(parseAmount('1,234')).toBeNull();
    expect(parseAmount('-3')).toBeNull();
  });
});
