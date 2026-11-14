import {
  approvableSide,
  canBreakLink,
  INVITATION_TOKEN_PATTERN,
  isGuardianOf,
  type LinkPartyDetails,
  type LinkRecord,
  linkViewFor,
  orderPair,
  planLink,
  toBlockedProfile,
  visibleName,
} from './link';

// LNK-02, LNK-06, LNK-07, PRO-05 : règles pures des liens.

function party(
  id: string,
  accountId: string,
  isChild = false,
  displayName = `Profil ${id}`,
): LinkPartyDetails {
  return { id, accountId, isChild, displayName, accentColor: '#336699', avatar: null };
}

function record(overrides: Partial<LinkRecord> & Pick<LinkRecord, 'a' | 'b'>): LinkRecord {
  return {
    id: 'link-1',
    status: 'ACCEPTED',
    requestedBy: overrides.a.id,
    aGuardianRequired: false,
    bGuardianRequired: false,
    aGuardianApprovedBy: null,
    bGuardianApprovedBy: null,
    createdAt: new Date('2026-11-14T10:00:00Z'),
    ...overrides,
  };
}

describe('orderPair (LNK-02, `CHECK a < b`)', () => {
  it('range la paire par identifiant, quel que soit l’ordre reçu', () => {
    const low = party('0001', 'acc-1');
    const high = party('0002', 'acc-2');
    expect(orderPair(low, high)).toEqual([low, high]);
    expect(orderPair(high, low)).toEqual([low, high]);
  });
});

describe('planLink (LNK-06)', () => {
  it('sans enfant : accepté d’office', () => {
    expect(planLink({ isChild: false }, { isChild: false })).toEqual({
      status: 'ACCEPTED',
      aGuardianRequired: false,
      bGuardianRequired: false,
    });
  });

  it('un enfant : attend la validation de son seul côté', () => {
    expect(planLink({ isChild: true }, { isChild: false })).toEqual({
      status: 'AWAITING_GUARDIAN',
      aGuardianRequired: true,
      bGuardianRequired: false,
    });
    expect(planLink({ isChild: false }, { isChild: true }).bGuardianRequired).toBe(true);
  });

  it('deux enfants : chaque côté est validé', () => {
    expect(planLink({ isChild: true }, { isChild: true })).toEqual({
      status: 'AWAITING_GUARDIAN',
      aGuardianRequired: true,
      bGuardianRequired: true,
    });
  });
});

describe('isGuardianOf (PRO-05, LNK-06)', () => {
  const child = party('c', 'acc-kid', true);

  it('un profil non enfant du même compte garde l’enfant', () => {
    expect(isGuardianOf(party('p', 'acc-kid'), child)).toBe(true);
  });

  it('ni un enfant, ni un profil d’un autre compte, ni le garde d’un non-enfant', () => {
    expect(isGuardianOf(party('k2', 'acc-kid', true), child)).toBe(false);
    expect(isGuardianOf(party('x', 'acc-other'), child)).toBe(false);
    expect(isGuardianOf(party('p', 'acc-kid'), party('q', 'acc-kid'))).toBe(false);
  });
});

describe('approvableSide, canBreakLink (LNK-02, LNK-06)', () => {
  const parent = party('p', 'acc-kid');
  const kid = party('k', 'acc-kid', true);
  const friend = party('z', 'acc-friend');
  const awaiting = record({
    a: kid,
    b: friend,
    status: 'AWAITING_GUARDIAN',
    aGuardianRequired: true,
  });

  it('seul le tuteur du côté enfant peut le valider', () => {
    expect(approvableSide(awaiting, parent)).toBe('A');
    expect(approvableSide(awaiting, friend)).toBeNull();
    expect(approvableSide(awaiting, kid)).toBeNull();
  });

  it('un côté déjà validé, ou un lien accepté, ne se valide plus', () => {
    expect(approvableSide({ ...awaiting, aGuardianApprovedBy: 'p' }, parent)).toBeNull();
    expect(approvableSide({ ...awaiting, status: 'ACCEPTED' }, parent)).toBeNull();
  });

  it('une partie ou le tuteur d’une partie enfant rompt ; un tiers non', () => {
    expect(canBreakLink(awaiting, friend)).toBe(true);
    expect(canBreakLink(awaiting, kid)).toBe(true);
    expect(canBreakLink(awaiting, parent)).toBe(true);
    expect(canBreakLink(awaiting, party('t', 'acc-third'))).toBe(false);
  });
});

describe('visibleName, linkViewFor (PRO-05)', () => {
  it('le nom d’un enfant est masqué tant que le lien n’est pas accepté', () => {
    const kid = party('k', 'acc-kid', true, 'Léa');
    expect(visibleName(kid, 'AWAITING_GUARDIAN')).toBeNull();
    expect(visibleName(kid, 'ACCEPTED')).toBe('Léa');
    expect(visibleName(party('p', 'acc-p', false, 'Paul'), 'AWAITING_GUARDIAN')).toBe('Paul');
  });

  it('la partie adverse ne lit pas le nom de l’enfant ; son tuteur oui', () => {
    const kid = party('k', 'acc-kid', true, 'Léa');
    const friend = party('z', 'acc-friend', false, 'Zoé');
    const parent = party('p', 'acc-kid', false, 'Paul');
    const link = record({
      a: kid,
      b: friend,
      status: 'AWAITING_GUARDIAN',
      aGuardianRequired: true,
    });
    expect(linkViewFor(link, friend)?.counterpart.displayName).toBeNull();
    const guardianView = linkViewFor(link, parent);
    expect(guardianView?.role).toBe('GUARDIAN');
    expect(guardianView?.child?.displayName).toBe('Léa');
    expect(guardianView?.awaitingMyApproval).toBe(true);
    expect(linkViewFor(link, party('t', 'acc-third'))).toBeNull();
  });
});

describe('INVITATION_TOKEN_PATTERN (LNK-01)', () => {
  it('22 caractères base64url (128 bits)', () => {
    expect(INVITATION_TOKEN_PATTERN.test('A'.repeat(22))).toBe(true);
    expect(INVITATION_TOKEN_PATTERN.test('A'.repeat(21))).toBe(false);
    expect(INVITATION_TOKEN_PATTERN.test(`${'A'.repeat(21)}=`)).toBe(false);
  });
});

describe('I1 (SEC-40) : le tuteur ne lit pas le nom de l’enfant d’en face', () => {
  it('même une fois le lien accepté', () => {
    const kidA = party('a', 'acc-x', true, 'Léa');
    const kidB = party('b', 'acc-y', true, 'Tom');
    const guardianA = party('p', 'acc-x', false, 'Paul');
    const link = record({
      a: kidA,
      b: kidB,
      status: 'ACCEPTED',
      aGuardianRequired: true,
      bGuardianRequired: true,
      aGuardianApprovedBy: 'p',
      bGuardianApprovedBy: 'q',
    });
    const view = linkViewFor(link, guardianA);
    expect(view?.counterpart.displayName).toBeNull();
    expect(view?.child?.displayName).toBe('Léa');
  });
});

describe('toBlockedProfile (PRO-05)', () => {
  it('masque le nom d’un enfant', () => {
    const row = { profileId: 'k', displayName: 'Léa', accentColor: '#336699' };
    expect(toBlockedProfile({ ...row, isChild: true }).displayName).toBeNull();
    expect(toBlockedProfile({ ...row, isChild: false }).displayName).toBe('Léa');
  });
});
