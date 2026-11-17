import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { ApiError } from '@wishlist/api-client';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { offlineActions } from '@/lib/offline/actions';
import { ActionQueue } from '@/lib/offline/queue';
import { QueueContext } from '@/lib/offline/queue-context';
import fr from '../../../messages/fr.json';
import { ActionsScreen } from './actions-screen';

// OFF-13, OFF-15 : une action refusée n'est jamais perdue sans explication ; un refus de
// participation propose le reste disponible ; une action en attente est montrée comme telle.

const ITEM = '0193f5a0-0000-7000-8000-0000000000aa';

async function queueWithRefusal(): Promise<ActionQueue> {
  let calls = 0;
  const queue = new ActionQueue('p1', null, () => {
    calls += 1;
    return Promise.reject(
      calls === 1
        ? new ApiError({
            type: 'x',
            title: 'x',
            status: 409,
            code: 'CONTRIBUTION_EXCEEDS_REMAINING',
            remainingMinor: 1_200,
          } as ApiError['problem'])
        : new TypeError('Failed to fetch'),
    );
  });
  await queue.perform(offlineActions.contribute(ITEM, { mode: 'FULL' }, 3_000), false);
  await queue.perform(offlineActions.comment(ITEM, 'GIVERS', 'Je passe au magasin'), false);
  await queue.run();
  return queue;
}

describe('ActionsScreen (OFF-13, OFF-15)', () => {
  it('refus expliqué, reste proposé ; commentaire en attente d’envoi', async () => {
    const queue = await queueWithRefusal();
    render(
      <NextIntlClientProvider locale="fr" messages={fr} timeZone="Europe/Paris">
        <QueryClientProvider client={new QueryClient()}>
          <QueueContext.Provider value={{ queue, online: true }}>
            <ActionsScreen />
          </QueueContext.Provider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(fr.offlineActions.reasons.CONTRIBUTION_EXCEEDS_REMAINING)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Participer avec le reste \(12,00/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abandonner' })).toBeTruthy();
    expect(screen.getByText(/Je passe au magasin/)).toBeTruthy();
    expect(screen.getByText(fr.offlineActions.waiting)).toBeTruthy();
  });
});
