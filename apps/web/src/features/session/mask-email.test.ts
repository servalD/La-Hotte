import { maskEmail } from './account-nav';

// Le menu de compte ne montre qu'un indice de l'adresse (écran familial partagé).
describe('maskEmail', () => {
  it('garde la première lettre et le domaine', () => {
    expect(maskEmail('gaetan@example.org')).toBe('g•••@example.org');
  });

  it('une valeur sans arobase ne révèle rien', () => {
    expect(maskEmail('abc')).toBe('•••');
    expect(maskEmail('@example.org')).toBe('•••');
  });
});
