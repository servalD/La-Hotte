import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './button';

describe('Button', () => {
  it('est atteignable et activable au clavier (A11Y-02)', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Ajouter</Button>);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Ajouter' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('garde une zone tactile d’au moins 44 px', () => {
    render(<Button>OK</Button>);
    expect(screen.getByRole('button').className).toContain('min-h-touch');
  });

  it('rend un lien avec l’apparence du bouton (asChild)', () => {
    render(
      <Button asChild>
        <a href="/listes">Mes listes</a>
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'Mes listes' })).toHaveClass('bg-primary');
  });
});
