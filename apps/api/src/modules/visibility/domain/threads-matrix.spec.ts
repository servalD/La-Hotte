import type {
  GiftContent,
  GiftExistence,
  ItemFacts,
  ItemStatus,
  ListFacts,
  ListRole,
  ListType,
} from './facts';
import { itemAccess, listAccess } from './rules';
import {
  activityThread,
  canModerateComment,
  publicThreadOpen,
  type ThreadLevel,
  threadAccess,
  threadLevel,
} from './threads';

// VIS-33 étendue aux fils (COM-01, COM-03, COM-04, COM-11, COM-12, COM-14, COM-15). Les attendus
// sont écrits à partir du texte de 06, avant le code (QA-10). Que le demandeur voie l'élément est
// une donnée, décidée par le moteur déjà couvert par `visibility-matrix.spec.ts` : la matrice
// vérifie ce que les fils en font.

const VIEWER = 'viewer';
const RECIPIENT = 'recipient';
const OTHER = 'other';

type Relation =
  'recipient' | 'co_recipient' | 'creator_giver' | 'owner' | 'reader' | 'circle' | 'outsider';
/** Règle de l'élément, relative aux destinataires et au demandeur. */
type RuleCase = 'ALL' | 'EXCEPT_RECIPIENTS' | 'ONLY_VIEWER' | 'EXCEPT_VIEWER';
type Author = 'giver' | 'recipient';

interface Case {
  type: ListType;
  relation: Relation;
  rule: RuleCase;
  author: Author;
  suggestion: boolean;
  status: ItemStatus;
  existence: GiftExistence;
  content: GiftContent;
  shown: boolean;
  archived: boolean;
}

const RELATIONS: Relation[] = [
  'recipient',
  'co_recipient',
  'creator_giver',
  'owner',
  'reader',
  'circle',
  'outsider',
];

function roleFor(relation: Relation, type: ListType): ListRole | null {
  switch (relation) {
    case 'recipient':
      return type === 'WISHLIST' ? 'CREATOR' : null;
    case 'co_recipient':
      return type === 'WISHLIST' ? 'CONTRIBUTOR' : null;
    case 'creator_giver':
      return 'CREATOR';
    case 'owner':
      return 'OWNER';
    case 'reader':
      return 'READER';
    default:
      return null;
  }
}

function recipientsOf(c: Case): string[] {
  return c.relation === 'recipient' || c.relation === 'co_recipient'
    ? [VIEWER, RECIPIENT]
    : [RECIPIENT];
}

function build(c: Case): { list: ListFacts; item: ItemFacts } {
  const recipients = recipientsOf(c);
  const role = roleFor(c.relation, c.type);
  const creatorTaken = role === 'CREATOR';
  const list: ListFacts = {
    id: 'list',
    type: c.type,
    audience: 'CIRCLE',
    recipients,
    members: [
      ...(role ? [{ profileId: VIEWER, role, since: new Date('2026-01-02') }] : []),
      ...(creatorTaken
        ? []
        : [
            {
              profileId: c.type === 'WISHLIST' ? RECIPIENT : OTHER,
              role: 'CREATOR' as const,
              since: new Date('2026-01-01'),
            },
          ]),
    ],
    customAudience: [],
    visibilityEditRole: 'CREATOR',
    giftExistence: c.existence,
    giftContent: c.content,
    personal: false,
    archived: c.archived,
    deleted: false,
    event: null,
  };
  const rule =
    c.rule === 'ALL'
      ? { mode: 'ALL' as const, profiles: [] }
      : c.rule === 'EXCEPT_RECIPIENTS'
        ? { mode: 'EXCEPT' as const, profiles: recipients }
        : c.rule === 'ONLY_VIEWER'
          ? { mode: 'ONLY' as const, profiles: [VIEWER] }
          : { mode: 'EXCEPT' as const, profiles: [VIEWER] };
  const item: ItemFacts = {
    id: 'item',
    listId: 'list',
    rule,
    status: c.status,
    isSuggestion: c.suggestion,
    shownToRecipient: c.shown,
    addedBy: c.author === 'recipient' ? RECIPIENT : OTHER,
  };
  return { list, item };
}

/** COM-12, écrit depuis le texte : au moins un destinataire voit l'élément. */
function expectedPublicOpen(c: Case): boolean {
  if (c.status === 'WITHDRAWN' || c.suggestion) return false;
  if (c.type === 'GIFTLIST') {
    if (c.existence === 'HIDDEN' || c.content === 'NONE') return false;
    if (c.content === 'PARTIAL' && !c.shown) return false;
  }
  // Un destinataire voit « le sien » quelle que soit la règle (VIS-17), sur une wishlist.
  if (c.type === 'WISHLIST' && c.author === 'recipient') return true;
  return recipientsOf(c).some((r) => {
    switch (c.rule) {
      case 'ALL':
        return true;
      case 'EXCEPT_RECIPIENTS':
        return false;
      case 'ONLY_VIEWER':
        return r === VIEWER;
      case 'EXCEPT_VIEWER':
        return r !== VIEWER;
    }
  });
}

function sees(c: Case): 'none' | 'recipient' | 'giver' {
  const { list, item } = build(c);
  const inCircle = c.relation === 'circle';
  return itemAccess(
    listAccess(list, { profileId: VIEWER, inRecipientsCircle: inCircle }),
    item,
    VIEWER,
  );
}

function* cases(): Generator<Case> {
  for (const type of ['WISHLIST', 'GIFTLIST'] as const)
    for (const relation of RELATIONS)
      for (const rule of ['ALL', 'EXCEPT_RECIPIENTS', 'ONLY_VIEWER', 'EXCEPT_VIEWER'] as const)
        for (const author of ['giver', 'recipient'] as const)
          for (const suggestion of [false, true])
            for (const status of ['OPEN', 'RESERVED', 'WITHDRAWN'] as const)
              for (const existence of type === 'GIFTLIST'
                ? (['HIDDEN', 'REVEALED'] as const)
                : (['HIDDEN'] as const))
                for (const content of type === 'GIFTLIST'
                  ? (['NONE', 'PARTIAL', 'FULL'] as const)
                  : (['NONE'] as const))
                  for (const shown of type === 'GIFTLIST' ? [false, true] : [false])
                    for (const archived of [false, true])
                      yield {
                        type,
                        relation,
                        rule,
                        author,
                        suggestion,
                        status,
                        existence,
                        content,
                        shown,
                        archived,
                      };
}

function level(read: boolean, archived: boolean): ThreadLevel {
  if (!read) return 'none';
  return archived ? 'read' : 'write';
}

describe('VIS-33 : matrice des fils (COM-01, COM-03, COM-04, COM-11, COM-12)', () => {
  const all = [...cases()];

  it('couvre des milliers de combinaisons', () => {
    expect(all.length).toBeGreaterThan(5_000);
  });

  it('chaque combinaison a les fils attendus', () => {
    const failures: string[] = [];
    for (const c of all) {
      const { list, item } = build(c);
      const access = listAccess(list, {
        profileId: VIEWER,
        inRecipientsCircle: c.relation === 'circle',
      });
      const seen = sees(c);
      const open = expectedPublicOpen(c);
      const expected = {
        // COM-01, COM-11 : le Public à qui voit l'élément, s'il existe (COM-12).
        public: level(seen !== 'none' && open, c.archived),
        // COM-01, COM-03 : l'Offreurs à qui le voit en offreur, jamais à un destinataire.
        givers: level(seen === 'giver', c.archived),
      };
      const got = threadAccess(list, access, item, VIEWER);
      if (got.public !== expected.public || got.givers !== expected.givers) {
        failures.push(
          `${JSON.stringify(c)} → ${JSON.stringify(got)} ≠ ${JSON.stringify(expected)}`,
        );
      }
      if (publicThreadOpen(list, item) !== open) failures.push(`open ${JSON.stringify(c)}`);
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it('VIS-20 : un destinataire ne lit jamais le fil Offreurs', () => {
    for (const c of all) {
      if (c.relation !== 'recipient' && c.relation !== 'co_recipient') continue;
      const { list, item } = build(c);
      const access = listAccess(list, { profileId: VIEWER, inRecipientsCircle: false });
      expect(threadAccess(list, access, item, VIEWER).givers).toBe('none');
    }
  });

  it('COM-12 : un destinataire qui voit l’élément a toujours le fil Public', () => {
    for (const c of all) {
      if (sees(c) !== 'recipient') continue;
      const { list, item } = build(c);
      const access = listAccess(list, { profileId: VIEWER, inRecipientsCircle: false });
      expect(threadAccess(list, access, item, VIEWER).public).not.toBe('none');
    }
  });
});

describe('threadLevel', () => {
  it('lit le niveau du fil demandé', () => {
    const access = { public: 'read', givers: 'write' } as const;
    expect(threadLevel(access, 'PUBLIC')).toBe('read');
    expect(threadLevel(access, 'GIVERS')).toBe('write');
  });
});

describe('COM-14 : fil d’une activité', () => {
  it('geste d’un destinataire : Public s’il est ouvert, sinon Offreurs ; d’un offreur : Offreurs', () => {
    for (const c of cases()) {
      if (c.archived || c.relation !== 'recipient') continue;
      const { list, item } = build(c);
      const open = expectedPublicOpen(c);
      expect(activityThread(list, item, VIEWER)).toBe(open ? 'PUBLIC' : 'GIVERS');
      expect(activityThread(list, item, OTHER)).toBe('GIVERS');
    }
  });
});

describe('COM-15 : suppression par l’autorité de la liste', () => {
  it('l’autorité (créateur, sinon plus ancien responsable) ; personne d’autre', () => {
    const { list } = build({
      type: 'GIFTLIST',
      relation: 'owner',
      rule: 'ALL',
      author: 'giver',
      suggestion: false,
      status: 'OPEN',
      existence: 'HIDDEN',
      content: 'NONE',
      shown: false,
      archived: false,
    });
    expect(canModerateComment(list, OTHER)).toBe(true);
    expect(canModerateComment(list, VIEWER)).toBe(false);
    const orphan: ListFacts = {
      ...list,
      members: list.members.filter((m) => m.role !== 'CREATOR'),
    };
    expect(canModerateComment(orphan, VIEWER)).toBe(true);
  });
});
