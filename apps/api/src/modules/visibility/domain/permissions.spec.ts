import type { ItemFacts, ListFacts, ListMemberFact, ListRole, VisibilityEditRole } from './facts';
import {
  addRight,
  authorityOf,
  canActAsRecipient,
  canArchiveList,
  canDeleteList,
  canEditItem,
  canEditItemRule,
  canEditList,
  canEditListRules,
  canManageMembers,
  canReadVisibilityLog,
  canRestoreList,
  listAccess,
  ruleExcludes,
} from './rules';

// Permissions d'action (LST-02, LST-03, LST-04, LST-09, LST-20, VIS-18, WSH-07 ; ADR 0016).

const ME = 'me';

function member(profileId: string, role: ListRole, since = '2026-01-01'): ListMemberFact {
  return { profileId, role, since: new Date(since) };
}

function list(partial: Partial<ListFacts> = {}): ListFacts {
  return {
    id: 'l',
    type: 'GIFTLIST',
    audience: 'MEMBERS',
    recipients: ['marie'],
    members: [member('creator', 'CREATOR')],
    customAudience: [],
    visibilityEditRole: 'CREATOR',
    giftExistence: 'HIDDEN',
    giftContent: 'NONE',
    personal: false,
    archived: false,
    deleted: false,
    ...partial,
  };
}

function item(partial: Partial<ItemFacts> = {}): ItemFacts {
  return {
    id: 'i',
    listId: 'l',
    rule: { mode: 'ALL', profiles: [] },
    status: 'OPEN',
    isSuggestion: false,
    shownToRecipient: false,
    addedBy: 'someone',
    ...partial,
  };
}

const access = (l: ListFacts, inCircle = false) =>
  listAccess(l, { profileId: ME, inRecipientsCircle: inCircle });

describe('Autorité (LST-04, LST-09)', () => {
  it('le créateur, sinon le plus ancien responsable, sinon personne', () => {
    expect(authorityOf(list())).toBe('creator');
    expect(
      authorityOf(
        list({ members: [member('b', 'OWNER', '2026-02-01'), member('a', 'OWNER', '2026-01-01')] }),
      ),
    ).toBe('a');
    expect(authorityOf(list({ members: [member('b', 'OWNER'), member('a', 'OWNER')] }))).toBe('a');
    expect(authorityOf(list({ members: [member('c', 'CONTRIBUTOR')] }))).toBeNull();
  });
});

describe('Liste : modifier, archiver, supprimer, restaurer (LST-02, LST-05, LST-20)', () => {
  it.each<[ListRole, boolean]>([
    ['CREATOR', true],
    ['OWNER', true],
    ['CONTRIBUTOR', false],
    ['READER', false],
  ])('%s modifie la liste et ses membres : %s', (role, allowed) => {
    const l = list({ members: [member(ME, role)] });
    expect(canEditList(l, access(l))).toBe(allowed);
    expect(canManageMembers(l, access(l))).toBe(allowed);
    expect(canArchiveList(l, access(l))).toBe(allowed);
  });

  it('une liste archivée ne se modifie plus, mais se désarchive', () => {
    const l = list({ members: [member(ME, 'CREATOR')], archived: true });
    expect(canEditList(l, access(l))).toBe(false);
    expect(canManageMembers(l, access(l))).toBe(false);
    expect(canArchiveList(l, access(l))).toBe(true);
  });

  it('seule l’autorité supprime et restaure ; « Mes envies » ne se supprime ni ne s’archive', () => {
    const mine = list({ members: [member(ME, 'CREATOR')] });
    expect(canDeleteList(mine, ME)).toBe(true);
    expect(
      canDeleteList(list({ members: [member(ME, 'OWNER'), member('c', 'CREATOR')] }), ME),
    ).toBe(false);
    expect(canDeleteList(list({ members: [member(ME, 'OWNER')] }), ME)).toBe(true); // LST-09
    const personal = list({
      type: 'WISHLIST',
      recipients: [ME],
      members: [member(ME, 'CREATOR')],
      personal: true,
    });
    expect(canDeleteList(personal, ME)).toBe(false);
    expect(canArchiveList(personal, access(personal))).toBe(false);
    expect(canRestoreList(mine, ME)).toBe(false);
    expect(canRestoreList({ ...mine, deleted: true }, ME)).toBe(true);
  });

  it('LST-20 : à la corbeille, la liste n’est vue que de son autorité', () => {
    const l = list({
      members: [member('creator', 'CREATOR'), member(ME, 'READER')],
      deleted: true,
    });
    expect(access(l).kind).toBe('none');
    const mine = list({ members: [member(ME, 'CREATOR')], deleted: true });
    expect(access(mine).kind).toBe('giver');
    expect(canEditList(mine, access(mine))).toBe(false);
    expect(canArchiveList(mine, access(mine))).toBe(false);
  });

  it('GFT-07 : le destinataire d’une giftlist à la corbeille ne voit rien, même révélée', () => {
    const l = list({ recipients: [ME], giftExistence: 'REVEALED', deleted: true, members: [] });
    expect(access(l).kind).toBe('none');
  });
});

describe('Ajouter (LST-02, WSH-04, WSH-07)', () => {
  const wish = (role: ListRole | null, recipient: boolean) =>
    list({
      type: 'WISHLIST',
      audience: 'CIRCLE',
      recipients: recipient ? [ME] : ['marie'],
      members: [
        ...(role ? [member(ME, role)] : []),
        ...(role === 'CREATOR' ? [] : [member('marie', 'CREATOR')]),
      ],
    });

  it.each<[string, ListFacts, boolean, string]>([
    ['destinataire créateur', wish('CREATOR', true), false, 'item'],
    ['destinataire lecteur', wish('READER', true), false, 'none'],
    ['parent créateur non destinataire', wish('CREATOR', false), false, 'item_or_suggestion'],
    ['offreur du cercle', wish(null, false), true, 'suggestion'],
    ['offreur lecteur', wish('READER', false), false, 'suggestion'],
    ['hors audience', wish(null, false), false, 'none'],
    ['giftlist, contributeur', list({ members: [member(ME, 'CONTRIBUTOR')] }), false, 'item'],
    ['giftlist, lecteur', list({ members: [member(ME, 'READER')] }), false, 'none'],
    [
      'giftlist révélée, destinataire',
      list({ recipients: [ME], giftExistence: 'REVEALED', members: [] }),
      false,
      'none',
    ],
  ])('%s → %s', (_label, l, inCircle, right) => {
    expect(addRight(l, access(l, inCircle))).toBe(right);
  });

  it('rien sur une liste archivée', () => {
    const l = list({ members: [member(ME, 'CREATOR')], archived: true });
    expect(addRight(l, access(l))).toBe('none');
  });
});

describe('Modifier un élément (LST-02, WSH-07)', () => {
  it.each<[ListRole, string, boolean]>([
    ['CREATOR', 'someone', true],
    ['OWNER', 'someone', true],
    ['CONTRIBUTOR', 'someone', false],
    ['CONTRIBUTOR', ME, true],
    ['READER', ME, false],
  ])('%s, élément de %s : %s', (role, author, allowed) => {
    const l = list({ members: [member(ME, role)] });
    expect(canEditItem(l, access(l), item({ addedBy: author }), ME)).toBe(allowed);
  });

  it('une suggestion n’est modifiable que par son auteur, même par le créateur', () => {
    const l = list({
      type: 'WISHLIST',
      recipients: ['marie'],
      members: [member(ME, 'CREATOR')],
    });
    expect(canEditItem(l, access(l), item({ isSuggestion: true, addedBy: 'x' }), ME)).toBe(false);
    expect(canEditItem(l, access(l), item({ isSuggestion: true, addedBy: ME }), ME)).toBe(true);
  });

  it('un élément invisible, ou une liste archivée : non', () => {
    const l = list({ members: [member(ME, 'CREATOR')] });
    const hidden = item({ rule: { mode: 'EXCEPT', profiles: [ME] } });
    expect(canEditItem(l, access(l), hidden, ME)).toBe(false);
    const archived = { ...l, archived: true };
    expect(canEditItem(archived, access(archived), item(), ME)).toBe(false);
  });
});

describe('Modifier une règle (LST-03, VIS-18)', () => {
  const cases: Array<[VisibilityEditRole, ListRole, boolean, string, boolean]> = [
    // réglage, rôle du demandeur, créateur présent, auteur de l'élément, attendu
    ['CREATOR', 'CREATOR', true, 'x', true],
    ['CREATOR', 'OWNER', true, 'x', false],
    ['CREATOR', 'OWNER', false, 'x', true], // le droit revient au responsable
    ['CREATOR', 'CONTRIBUTOR', true, ME, false],
    ['OWNER', 'OWNER', true, 'x', true],
    ['OWNER', 'CONTRIBUTOR', true, ME, false],
    ['CONTRIBUTOR', 'CONTRIBUTOR', true, ME, true],
    ['CONTRIBUTOR', 'CONTRIBUTOR', true, 'x', false], // VIS-18 : ses éléments seulement
    ['CONTRIBUTOR', 'OWNER', true, 'x', true],
    ['CONTRIBUTOR', 'READER', true, ME, false],
  ];
  it.each(cases)(
    'réglage %s, %s (créateur présent : %s), élément de %s → %s',
    (setting, role, creator, author, allowed) => {
      const members = [
        member(ME, role, '2026-02-01'),
        ...(creator && role !== 'CREATOR' ? [member('c', 'CREATOR')] : []),
      ];
      const l = list({ members, visibilityEditRole: setting });
      expect(canEditItemRule(l, access(l), item({ addedBy: author }), ME)).toBe(allowed);
    },
  );

  it('défaut de la liste : l’autorité, ou les responsables selon le réglage', () => {
    const owner = list({ members: [member(ME, 'OWNER'), member('c', 'CREATOR')] });
    expect(canEditListRules(owner, access(owner), ME)).toBe(false);
    const delegated = { ...owner, visibilityEditRole: 'OWNER' as const };
    expect(canEditListRules(delegated, access(delegated), ME)).toBe(true);
    const orphan = list({ members: [member(ME, 'OWNER', '2026-03-01'), member('o', 'OWNER')] });
    expect(canEditListRules(orphan, access(orphan), ME)).toBe(true);
    const contributor = list({
      members: [member(ME, 'CONTRIBUTOR'), member('c', 'CREATOR')],
      visibilityEditRole: 'CONTRIBUTOR',
    });
    expect(canEditListRules(contributor, access(contributor), ME)).toBe(false);
    const archived = list({ members: [member(ME, 'CREATOR')], archived: true });
    expect(canEditListRules(archived, access(archived), ME)).toBe(false);
    const creator = list({ members: [member(ME, 'CREATOR')] });
    expect(canEditListRules(creator, access(creator), ME)).toBe(true);
  });

  it('suggestion : son auteur seul ; élément invisible ou liste archivée : non', () => {
    const l = list({ type: 'WISHLIST', recipients: ['m'], members: [member(ME, 'CREATOR')] });
    expect(canEditItemRule(l, access(l), item({ isSuggestion: true, addedBy: 'x' }), ME)).toBe(
      false,
    );
    expect(canEditItemRule(l, access(l), item({ isSuggestion: true, addedBy: ME }), ME)).toBe(true);
    const hidden = item({ rule: { mode: 'ONLY', profiles: ['x'] } });
    expect(canEditItemRule(l, access(l), hidden, ME)).toBe(false);
    const archived = { ...l, archived: true };
    expect(canEditItemRule(archived, access(archived), item(), ME)).toBe(false);
  });

  it('VIS-14 : le journal est lu par l’autorité seule', () => {
    expect(canReadVisibilityLog(list({ members: [member(ME, 'CREATOR')] }), ME)).toBe(true);
    expect(canReadVisibilityLog(list(), ME)).toBe(false);
  });
});

describe('Reçu et retrait (LST-13, LST-15, LST-18)', () => {
  it('un destinataire d’une wishlist seulement, sur un souhait qu’il voit', () => {
    const wish = list({ type: 'WISHLIST', recipients: [ME], members: [member(ME, 'CREATOR')] });
    expect(canActAsRecipient(wish, access(wish), item(), ME)).toBe(true);
    expect(canActAsRecipient(wish, access(wish), item({ isSuggestion: true }), ME)).toBe(false);
    expect(canActAsRecipient({ ...wish, archived: true }, access(wish), item(), ME)).toBe(false);
    const giver = list({ members: [member(ME, 'CREATOR')] });
    expect(canActAsRecipient(giver, access(giver), item(), ME)).toBe(false);
    const gift = list({
      recipients: [ME],
      giftExistence: 'REVEALED',
      giftContent: 'FULL',
      members: [],
    });
    expect(canActAsRecipient(gift, access(gift), item(), ME)).toBe(false);
  });
});

describe('Règle d’élément (VIS-10)', () => {
  it('trois valeurs', () => {
    expect(ruleExcludes({ mode: 'ALL', profiles: [ME] }, ME)).toBe(false);
    expect(ruleExcludes({ mode: 'ONLY', profiles: [ME] }, ME)).toBe(false);
    expect(ruleExcludes({ mode: 'ONLY', profiles: [] }, ME)).toBe(true);
    expect(ruleExcludes({ mode: 'EXCEPT', profiles: [ME] }, ME)).toBe(true);
    expect(ruleExcludes({ mode: 'EXCEPT', profiles: [] }, ME)).toBe(false);
  });
});
