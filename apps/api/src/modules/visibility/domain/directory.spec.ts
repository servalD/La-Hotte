import { globalProductVisible, requiresHiddenItemChoice, sharedProductVisible } from './rules';

// REP-03, REP-04, REP-06, REP-07, REP-10, MOD-06, MOD-12.

const base = {
  viewerId: 'tonton',
  ownerId: 'papa',
  shareLevel: 'CIRCLE' as const,
  viewerInOwnerCircle: true,
  references: [],
};
const open = { rule: { mode: 'ALL' as const, profiles: [] }, listRecipients: ['marie'] };

describe('Répertoire (REP-03, REP-07, REP-10)', () => {
  it('le cercle du propriétaire voit une fiche publiée au cercle', () => {
    expect(sharedProductVisible({ ...base, references: [open] })).toBe(true);
  });

  it.each([
    ['privée', { shareLevel: 'PRIVATE' as const }],
    ['catalogue global : sa propre règle', { shareLevel: 'GLOBAL' as const }],
    ['hors du cercle', { viewerInOwnerCircle: false }],
    ['le propriétaire lui-même', { viewerId: 'papa' }],
    ['fiche sans propriétaire (PRO-06)', { ownerId: null }],
  ])('pas visible : %s', (_label, change) => {
    expect(sharedProductVisible({ ...base, ...change })).toBe(false);
  });

  it('REP-07 : écarté par la règle d’un élément qui la référence', () => {
    const hidden = { rule: { mode: 'EXCEPT' as const, profiles: ['tonton'] }, listRecipients: [] };
    expect(sharedProductVisible({ ...base, references: [open, hidden] })).toBe(false);
    const only = { rule: { mode: 'ONLY' as const, profiles: ['mamie'] }, listRecipients: [] };
    expect(sharedProductVisible({ ...base, references: [only] })).toBe(false);
  });

  it('REP-10 : jamais au destinataire d’un élément qui la référence', () => {
    expect(sharedProductVisible({ ...base, viewerId: 'marie', references: [open] })).toBe(false);
  });

  it('REP-06 : un élément caché exige le choix explicite', () => {
    expect(requiresHiddenItemChoice([open])).toBe(false);
    expect(
      requiresHiddenItemChoice([
        open,
        { rule: { mode: 'ONLY', profiles: ['x'] }, listRecipients: [] },
      ]),
    ).toBe(true);
  });
});

describe('Catalogue global (MOD-06, MOD-12, REP-04, REP-07, REP-10)', () => {
  const global = {
    viewerId: 'inconnu',
    ownerId: 'papa',
    shareLevel: 'GLOBAL' as const,
    moderationStatus: 'APPROVED' as const,
    references: [open],
  };

  it('tout profil voit une fiche approuvée, hors de tout cercle', () => {
    expect(globalProductVisible(global)).toBe(true);
  });

  it.each([
    ['en attente de modération', { moderationStatus: 'PENDING' as const }],
    ['retirée par la modération', { moderationStatus: 'REJECTED' as const }],
    ['jamais soumise', { moderationStatus: 'NONE' as const }],
    ['publiée au cercle seulement', { shareLevel: 'CIRCLE' as const }],
    ['le propriétaire lui-même', { viewerId: 'papa' }],
    ['destinataire d’un élément qui la référence (REP-10)', { viewerId: 'marie' }],
  ])('pas visible : %s', (_label, change) => {
    expect(globalProductVisible({ ...global, ...change })).toBe(false);
  });

  it('REP-07 : écarté par la règle d’un élément qui la référence', () => {
    const hidden = { rule: { mode: 'EXCEPT' as const, profiles: ['inconnu'] }, listRecipients: [] };
    expect(globalProductVisible({ ...global, references: [open, hidden] })).toBe(false);
  });
});
