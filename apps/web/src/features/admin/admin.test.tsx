import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fr from '../../../messages/fr.json';
import { AdminActionsSection } from '../account/admin-actions-section';
import { ReportButton } from '../moderation/report-button';
import { AdminStats } from './admin-stats';
import { ModerationQueue } from './moderation-queue';

// STA-01, STA-02, ADM-05, MOD-07, MOD-10 : écrans de l'administration et du signalement.

interface State {
  stats: unknown;
  queue: unknown;
  actions: unknown;
  report: ReturnType<typeof vi.fn>;
  decide: ReturnType<typeof vi.fn>;
}

const state = vi.hoisted((): State => ({
  stats: null,
  queue: null,
  actions: null,
  report: vi.fn(),
  decide: vi.fn(),
}));

vi.mock('@wishlist/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wishlist/api-client')>();
  return {
    ...actual,
    useGetPlatformStats: () => ({ data: state.stats }),
    useGetModerationQueue: () => ({ data: state.queue }),
    useDecideModeration: () => ({ mutate: state.decide, isPending: false }),
    useDecideModerationContest: () => ({ mutate: vi.fn(), isPending: false }),
    useReportContent: () => ({ mutate: state.report, isPending: false }),
    useListAdminActionsOnAccount: () => ({ data: state.actions }),
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
  state.report.mockReset();
  state.decide.mockReset();
});

describe('Tableau de bord (STA-01, STA-02)', () => {
  it('un agrégat masqué est dit, jamais montré à zéro', () => {
    state.stats = {
      activeAccounts30d: null,
      accountsCreated30d: 12,
      listsCreated30d: 30,
      catalogProducts: 0,
      openReports: 2,
      medianReportHours: 5.25,
      extractionSuccessRate: 0.9,
    };
    wrap(<AdminStats />);
    expect(screen.getAllByText(fr.admin.stats.masked).length).toBeGreaterThan(0);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('90 %')).toBeInTheDocument();
  });
});

describe('File de modération (ADM-05, MOD-10)', () => {
  it('un message : texte, fil et motifs ; trois décisions, avec motif', () => {
    state.queue = {
      items: [
        {
          kind: 'COMMENT',
          comment: {
            id: 'c1',
            thread: 'GIVERS',
            body: 'Texte signalé',
            createdAt: '2026-11-17T10:00:00.000Z',
          },
          reports: {
            reasons: [{ reason: 'SPAM', count: 2 }],
            notes: ['Lien douteux'],
            firstAt: '2026-11-17T11:00:00.000Z',
          },
        },
      ],
    };
    wrap(<ModerationQueue />);
    expect(screen.getByText('Texte signalé')).toBeInTheDocument();
    expect(screen.getByText(/Fil des offreurs/)).toBeInTheDocument();
    expect(screen.getByText('Lien douteux')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(fr.admin.reason), {
      target: { value: 'Publicité répétée' },
    });
    fireEvent.click(screen.getByRole('button', { name: fr.admin.moderation.remove }));
    expect(state.decide).toHaveBeenCalledWith(
      { kind: 'comments', id: 'c1', data: { decision: 'REMOVE', reason: 'Publicité répétée' } },
      expect.anything(),
    );
  });

  it('rien à traiter', () => {
    state.queue = { items: [] };
    wrap(<ModerationQueue />);
    expect(screen.getByText(fr.admin.moderation.empty)).toBeInTheDocument();
  });
});

describe('Signaler (MOD-07)', () => {
  it('la fenêtre dit qui lira, et envoie le motif choisi', () => {
    wrap(<ReportButton targetKind="PRODUCT" targetId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: fr.report.open }));
    expect(screen.getByText(fr.report.who)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(fr.report.reason), { target: { value: 'PRIVACY' } });
    fireEvent.click(screen.getByRole('button', { name: fr.report.send }));
    expect(state.report).toHaveBeenCalledWith(
      { data: { targetKind: 'PRODUCT', targetId: 'p1', reason: 'PRIVACY' } },
      expect.anything(),
    );
  });
});

describe('Actions de l’équipe sur mon compte (AUD-07)', () => {
  it('libellé de l’action et motif, sans acteur', () => {
    state.actions = {
      items: [
        { action: 'account.suspend', at: '2026-11-17T10:00:00.000Z', reason: 'Spam répété' },
        { action: 'role.grant', at: '2026-11-16T10:00:00.000Z', reason: null },
      ],
    };
    wrap(<AdminActionsSection />);
    expect(screen.getByText(fr.admin.audit.actions.account_suspend)).toBeInTheDocument();
    expect(screen.getByText(fr.admin.audit.actions.role_grant)).toBeInTheDocument();
    expect(screen.getByText(/Spam répété/)).toBeInTheDocument();
  });
});
