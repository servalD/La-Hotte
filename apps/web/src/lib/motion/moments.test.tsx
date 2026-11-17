import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// MOT-01 à MOT-05 : avec `prefers-reduced-motion`, aucun déplacement ni célébration ; aucune
// information ne dépend d'une animation (le texte final est écrit, la jauge a sa valeur).

const reduced = vi.hoisted(() => ({ value: true }));

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return { ...actual, useReducedMotion: () => reduced.value };
});

const { AnimatedAmount, Celebration, DragToClose, FundingGauge } = await import('./moments');

describe('Mouvement réduit (MOT-04)', () => {
  it('aucune célébration ; montant écrit tout de suite ; tiroir sans glissement', () => {
    reduced.value = true;
    const { container } = render(
      <div>
        <Celebration active />
        <AnimatedAmount value={4_200} format={(v) => `${String(v / 100)} €`} />
        <DragToClose onClose={() => undefined}>
          <p>contenu</p>
        </DragToClose>
      </div>,
    );
    expect(container.querySelectorAll('span.rounded-sm')).toHaveLength(0);
    expect(screen.getByText('42 €')).toBeTruthy();
    expect(screen.getByText('contenu')).toBeTruthy();
  });

  it('la jauge porte sa valeur pour les lecteurs d’écran, sans dépendre de l’animation', () => {
    reduced.value = true;
    render(<FundingGauge covered={3_000} total={12_000} label="Financement" />);
    const gauge = screen.getByRole('progressbar', { name: 'Financement' });
    expect(gauge.getAttribute('aria-valuenow')).toBe('25');
  });

  it('mouvement normal : célébration jouée, et toujours non bloquante', () => {
    reduced.value = false;
    const { container } = render(<Celebration active />);
    const pieces = container.querySelectorAll('span.rounded-sm');
    expect(pieces).toHaveLength(12);
    expect((container.firstElementChild as HTMLElement).className).toContain('pointer-events-none');
  });
});
