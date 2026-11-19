import {
  globalProductCountable,
  globalProductVisible,
  moderationWithheld,
  requiresHiddenItemChoice,
  sharedProductVisible,
} from './rules';

// REP-03, REP-04, REP-06, REP-07, REP-10, MOD-06, MOD-12.

const base = {
  viewerId: 'tonton',
  ownerId: 'papa',
  shareLevel: 'CIRCLE' as const,
  viewerInOwnerCircle: true,
  references: [],
};
const open = {
  rule: { mode: 'ALL' as const, profiles: [] },
  listRecipients: ['marie'],
  surpriseFor: [],
};

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
    const hidden = {
      rule: { mode: 'EXCEPT' as const, profiles: ['tonton'] },
      listRecipients: [],
      surpriseFor: [],
    };
    expect(sharedProductVisible({ ...base, references: [open, hidden] })).toBe(false);
    const only = {
      rule: { mode: 'ONLY' as const, profiles: ['mamie'] },
      listRecipients: [],
      surpriseFor: [],
    };
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
        { rule: { mode: 'ONLY', profiles: ['x'] }, listRecipients: [], surpriseFor: [] },
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
    const hidden = {
      rule: { mode: 'EXCEPT' as const, profiles: ['inconnu'] },
      listRecipients: [],
      surpriseFor: [],
    };
    expect(globalProductVisible({ ...global, references: [open, hidden] })).toBe(false);
  });
});

describe('Modération soustraite au modérateur concerné (ADM-05, MOD-10, RBAC-12)', () => {
  const all = { mode: 'ALL' as const, profiles: [] };
  const base = { actorProfileIds: ['m1', 'm2'], authorId: 'paul', references: [] };

  it('un modérateur sans lien voit le contenu', () => {
    expect(moderationWithheld(base)).toBe(false);
    expect(
      moderationWithheld({
        ...base,
        references: [{ rule: all, listRecipients: ['lea'], surpriseFor: [] }],
      }),
    ).toBe(false);
  });

  it('soustrait si un profil du compte est destinataire, écarté ou auteur', () => {
    expect(
      moderationWithheld({
        ...base,
        references: [{ rule: all, listRecipients: ['m2'], surpriseFor: [] }],
      }),
    ).toBe(true);
    expect(
      moderationWithheld({
        ...base,
        references: [
          { rule: { mode: 'EXCEPT', profiles: ['m1'] }, listRecipients: ['lea'], surpriseFor: [] },
        ],
      }),
    ).toBe(true);
    expect(moderationWithheld({ ...base, authorId: 'm1' })).toBe(true);
  });
});

describe('Surprise et répertoire (REP-10, EVT-04, ADM-05)', () => {
  const honoree = {
    rule: { mode: 'ALL' as const, profiles: [] },
    listRecipients: ['paul'],
    surpriseFor: ['lea'],
  };

  it('une fiche ne disparaît pas du répertoire d’un honoré quand sa liste rejoint une surprise', () => {
    expect(
      sharedProductVisible({
        viewerId: 'lea',
        ownerId: 'zoe',
        shareLevel: 'CIRCLE',
        viewerInOwnerCircle: true,
        references: [honoree],
      }),
    ).toBe(true);
    expect(
      globalProductVisible({
        viewerId: 'lea',
        ownerId: 'zoe',
        shareLevel: 'GLOBAL',
        moderationStatus: 'APPROVED',
        references: [honoree],
      }),
    ).toBe(true);
  });

  it('mais la modération la soustrait à l’honoré', () => {
    expect(
      moderationWithheld({ actorProfileIds: ['lea'], authorId: 'zoe', references: [honoree] }),
    ).toBe(true);
  });
});

describe('Compteur du catalogue, le même pour tous (MOD-05, revue SEC-40 I1)', () => {
  const all = { mode: 'ALL' as const, profiles: [] };
  it('une fiche de la wishlist de son auteur, visible de tous, compte', () => {
    expect(
      globalProductCountable({
        ownerId: 'papa',
        references: [{ rule: all, listRecipients: ['papa'], surpriseFor: ['mamie'] }],
      }),
    ).toBe(true);
    expect(globalProductCountable({ ownerId: 'papa', references: [] })).toBe(true);
  });

  it('une fiche préparée pour quelqu’un, ou cachée par une règle, ne compte pas', () => {
    expect(
      globalProductCountable({
        ownerId: 'papa',
        references: [{ rule: all, listRecipients: ['marie'], surpriseFor: [] }],
      }),
    ).toBe(false);
    expect(
      globalProductCountable({
        ownerId: 'papa',
        references: [
          {
            rule: { mode: 'EXCEPT', profiles: ['tonton'] },
            listRecipients: ['papa'],
            surpriseFor: [],
          },
        ],
      }),
    ).toBe(false);
  });
});
