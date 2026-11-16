import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fr from '../../../messages/fr.json';
import { ItemThreads } from './item-threads';
import { LightMarkdown } from './light-markdown';

// COM-02, COM-03, COM-09, COM-12, COM-13 : l'écran affiche les fils que l'API rend ; un
// destinataire n'a ni onglet ni compteur du fil Offreurs ; la saisie dit toujours qui lira.

const state = vi.hoisted((): { threads: unknown; comments: unknown[] } => ({
  threads: null,
  comments: [],
}));

vi.mock('@wishlist/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wishlist/api-client')>();
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    ...actual,
    useGetItemThreads: () => ({ data: state.threads }),
    useListItemComments: () => ({
      data: { items: state.comments, nextCursor: null },
      isPending: false,
    }),
    usePostItemComment: mutation,
    useDeleteOneComment: mutation,
    useAddCommentReaction: mutation,
    useRemoveCommentReaction: mutation,
    useFollowOneItem: mutation,
    useUnfollowOneItem: mutation,
  };
});

function wrap(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Europe/Paris">
      <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.comments = [];
});

describe('ItemThreads', () => {
  it('destinataire : ni onglet ni compteur du fil Offreurs', () => {
    state.threads = { view: 'recipient', public: { count: 2, canWrite: true }, following: true };
    wrap(<ItemThreads itemId="i" />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByText(/offreurs/i)).toBeNull();
    expect(screen.getByText(fr.threads.audienceSelf)).toBeInTheDocument();
  });

  it('offreur : fil Offreurs ouvert par défaut, avec « ne verront pas »', () => {
    state.threads = {
      view: 'giver',
      public: { count: 1, canWrite: true },
      givers: { count: 3, canWrite: true },
      following: false,
    };
    wrap(<ItemThreads itemId="i" />);
    expect(screen.getByRole('tab', { name: /Entre offreurs \(3\)/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText(fr.threads.audienceGivers)).toBeInTheDocument();
  });

  it('COM-12 : fil Public fermé, dit pourquoi', () => {
    state.threads = {
      view: 'giver',
      public: null,
      givers: { count: 0, canWrite: true },
      following: true,
    };
    wrap(<ItemThreads itemId="i" />);
    expect(screen.getByText(fr.threads.publicClosed)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Avec les destinataires/ })).toBeNull();
  });
});

describe('LightMarkdown (COM-09, COM-13)', () => {
  it('gras, italique, liens sûrs, listes ; aucun HTML interprété', () => {
    const { container } = render(
      <LightMarkdown
        text={
          '**Bleu** ou _rouge_ ?\n- taille M\n<img src=x onerror=alert(1)> https://exemple.fr/a'
        }
      />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('Bleu');
    expect(container.querySelector('em')?.textContent).toBe('rouge');
    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(container.querySelector('img')).toBeNull();
    const link = container.querySelector('a');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('href')).toBe('https://exemple.fr/a');
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
