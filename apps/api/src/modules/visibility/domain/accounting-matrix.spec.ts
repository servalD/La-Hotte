import {
  accountingLevel,
  canContribute,
  canDecideBuyerRequest,
  canDecideReview,
  canSeeAmounts,
  canSeeSettlement,
  engagementBlocksRuleChange,
  type AccountingLevel,
} from './accounting';
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

// VIS-33 étendue à la compta (CPT-52, CPT-59 à CPT-61, VIS-37). Les attendus sont écrits à
// partir du texte de 07 et 04, avant le code (QA-10). Ce que le demandeur voit de l'élément est
// décidé par le moteur déjà couvert (`visibility-matrix.spec.ts`) ; la matrice vérifie ce que la
// compta en fait, combinée à l'engagement du demandeur.

const VIEWER = 'viewer';
const RECIPIENT = 'recipient';
const OTHER = 'other';
const BUYER = 'buyer';

type Relation =
  'recipient' | 'co_recipient' | 'owner' | 'reader' | 'circle' | 'outsider' | 'honoree';
type RuleCase = 'ALL' | 'ONLY_VIEWER' | 'EXCEPT_VIEWER';
type Engagement = 'none' | 'participant' | 'buyer';

interface Case {
  type: ListType;
  relation: Relation;
  rule: RuleCase;
  suggestion: boolean;
  status: ItemStatus;
  existence: GiftExistence;
  content: GiftContent;
  engagement: Engagement;
  detached: boolean;
  archived: boolean;
  closed: boolean;
}

const RELATIONS: Relation[] = [
  'recipient',
  'co_recipient',
  'owner',
  'reader',
  'circle',
  'outsider',
  'honoree',
];

function roleFor(relation: Relation, type: ListType): ListRole | null {
  switch (relation) {
    case 'recipient':
      return type === 'WISHLIST' ? 'CREATOR' : null;
    case 'co_recipient':
      return type === 'WISHLIST' ? 'CONTRIBUTOR' : null;
    case 'owner':
      return 'OWNER';
    case 'reader':
      return 'READER';
    default:
      return null;
  }
}

const isRecipient = (c: Case) => c.relation === 'recipient' || c.relation === 'co_recipient';

function build(c: Case): { list: ListFacts; item: ItemFacts } {
  const recipients = isRecipient(c) ? [VIEWER, RECIPIENT] : [RECIPIENT];
  const role = roleFor(c.relation, c.type);
  const list: ListFacts = {
    id: 'list',
    type: c.type,
    audience: 'CIRCLE',
    recipients,
    members: [
      ...(role ? [{ profileId: VIEWER, role, since: new Date('2026-01-02') }] : []),
      ...(role === 'CREATOR'
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
    event: {
      id: 'event',
      audience: [VIEWER, RECIPIENT, OTHER],
      closed: c.closed,
      hiddenFrom: c.relation === 'honoree' ? [VIEWER] : [],
    },
  };
  const rule =
    c.rule === 'ALL'
      ? { mode: 'ALL' as const, profiles: [] }
      : c.rule === 'ONLY_VIEWER'
        ? { mode: 'ONLY' as const, profiles: [VIEWER] }
        : { mode: 'EXCEPT' as const, profiles: [VIEWER] };
  const item: ItemFacts = {
    id: 'item',
    listId: 'list',
    rule,
    status: c.status,
    isSuggestion: c.suggestion,
    shownToRecipient: true,
    addedBy: OTHER,
  };
  return { list, item };
}

function subjectOf(c: Case) {
  if (c.detached) return null;
  const { list, item } = build(c);
  const access = listAccess(list, {
    profileId: VIEWER,
    inRecipientsCircle: c.relation === 'circle',
  });
  return { list, access, item };
}

function factsOf(c: Case) {
  const participants = [OTHER, BUYER, ...(c.engagement === 'none' ? [] : [VIEWER])];
  return { participants, buyerId: c.engagement === 'buyer' ? VIEWER : BUYER };
}

function seen(c: Case): 'none' | 'recipient' | 'giver' {
  const subject = subjectOf(c);
  return subject ? itemAccess(subject.access, subject.item, VIEWER) : 'none';
}

/** Écrit depuis le texte (CPT-52, CPT-59, VIS-20, VIS-36, VIS-37, CPT-73). */
function expectedLevel(c: Case): AccountingLevel {
  // VIS-20, CPT-52 : un destinataire de la liste n'en reçoit rien, même engagé.
  if (!c.detached && isRecipient(c)) return 'none';
  // VIS-36 : l'honoré d'une surprise ne reçoit rien d'une liste rattachée.
  if (!c.detached && c.relation === 'honoree') return 'none';
  if (c.engagement !== 'none') return c.engagement; // VIS-37, CPT-73 : la participation ouvre l'accès.
  if (c.detached) return 'none';
  return seen(c) === 'giver' ? 'giver' : 'none';
}

function* cases(): Generator<Case> {
  for (const type of ['WISHLIST', 'GIFTLIST'] as const)
    for (const relation of RELATIONS)
      for (const rule of ['ALL', 'ONLY_VIEWER', 'EXCEPT_VIEWER'] as const)
        for (const suggestion of [false, true])
          for (const status of ['OPEN', 'RESERVED', 'WITHDRAWN'] as const)
            for (const existence of type === 'GIFTLIST'
              ? (['HIDDEN', 'REVEALED'] as const)
              : (['HIDDEN'] as const))
              for (const content of type === 'GIFTLIST'
                ? (['NONE', 'FULL'] as const)
                : (['NONE'] as const))
                for (const engagement of ['none', 'participant', 'buyer'] as const)
                  for (const detached of [false, true])
                    for (const archived of [false, true])
                      for (const closed of [false, true])
                        yield {
                          type,
                          relation,
                          rule,
                          suggestion,
                          status,
                          existence,
                          content,
                          engagement,
                          detached,
                          archived,
                          closed,
                        };
}

describe('VIS-33 : matrice de la compta (CPT-52, CPT-59, VIS-37)', () => {
  const all = [...cases()];

  it('couvre des milliers de combinaisons', () => {
    expect(all.length).toBeGreaterThan(10_000);
  });

  it('chaque combinaison a le niveau d’accès attendu', () => {
    const failures: string[] = [];
    for (const c of all) {
      const got = accountingLevel(subjectOf(c), factsOf(c), VIEWER);
      const expected = expectedLevel(c);
      if (got !== expected) failures.push(`${JSON.stringify(c)} → ${got} ≠ ${expected}`);
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it('VIS-20 : un destinataire n’a jamais aucun accès, engagé ou non', () => {
    for (const c of all) {
      if (!isRecipient(c) || c.detached) continue;
      expect(accountingLevel(subjectOf(c), factsOf(c), VIEWER)).toBe('none');
    }
  });

  it('CPT-60 : participer exige la forme offreur, une liste modifiable et un élément non retiré', () => {
    const failures: string[] = [];
    for (const c of all) {
      const subject = subjectOf(c);
      const expected =
        !c.detached &&
        seen(c) === 'giver' &&
        !c.archived &&
        !c.closed &&
        c.status !== 'WITHDRAWN' &&
        c.relation !== 'honoree';
      const got = subject !== null && canContribute(subject, VIEWER);
      if (got !== expected) failures.push(`${JSON.stringify(c)} → ${String(got)}`);
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });
});

describe('CPT-59 : ce que chaque niveau lit', () => {
  const levels: AccountingLevel[] = ['none', 'giver', 'participant', 'buyer'];

  it('les montants, options, demandes et justificatif : participants seulement', () => {
    expect(levels.filter(canSeeAmounts)).toEqual(['participant', 'buyer']);
  });

  it('le règlement d’une part : son participant et l’acheteur, s’ils ont accès', () => {
    expect(canSeeSettlement('participant', VIEWER, VIEWER, BUYER)).toBe(true);
    expect(canSeeSettlement('buyer', VIEWER, OTHER, VIEWER)).toBe(true);
    expect(canSeeSettlement('participant', VIEWER, OTHER, BUYER)).toBe(false);
    expect(canSeeSettlement('giver', VIEWER, VIEWER, BUYER)).toBe(false);
    expect(canSeeSettlement('none', VIEWER, VIEWER, VIEWER)).toBe(false);
  });
});

describe('CPT-58 : revue', () => {
  it('un autre participant que l’auteur ; jamais un simple offreur', () => {
    expect(canDecideReview('participant', VIEWER, OTHER)).toBe(true);
    expect(canDecideReview('buyer', VIEWER, OTHER)).toBe(true);
    expect(canDecideReview('participant', VIEWER, VIEWER)).toBe(false);
    expect(canDecideReview('giver', VIEWER, OTHER)).toBe(false);
    expect(canDecideReview('participant', VIEWER, null)).toBe(true);
  });
});

describe('CPT-61 : changement d’acheteur', () => {
  const requestedAt = new Date('2026-12-01T10:00:00Z');
  const early = new Date('2026-12-02T09:59:59Z');
  const late = new Date('2026-12-03T10:00:00Z');
  const base = { viewerId: VIEWER, candidateId: OTHER, buyerId: BUYER, requestedAt };

  it('l’acheteur en place décide toujours ; le candidat jamais', () => {
    expect(
      canDecideBuyerRequest({
        ...base,
        level: 'buyer',
        buyerId: VIEWER,
        now: early,
        organizers: null,
        seenAsGiver: true,
      }),
    ).toBe(true);
    expect(
      canDecideBuyerRequest({
        ...base,
        level: 'participant',
        candidateId: VIEWER,
        now: late,
        organizers: null,
        seenAsGiver: true,
      }),
    ).toBe(false);
  });

  it('après 48 heures : un organisateur qui voit en offreur, ou hors événement un autre participant', () => {
    const participant = { ...base, level: 'participant' as const };
    expect(
      canDecideBuyerRequest({ ...participant, now: early, organizers: null, seenAsGiver: true }),
    ).toBe(false);
    expect(
      canDecideBuyerRequest({ ...participant, now: late, organizers: null, seenAsGiver: true }),
    ).toBe(true);
    expect(
      canDecideBuyerRequest({ ...participant, now: late, organizers: [OTHER], seenAsGiver: true }),
    ).toBe(false);
    expect(
      canDecideBuyerRequest({
        ...base,
        level: 'giver',
        now: late,
        organizers: [VIEWER],
        seenAsGiver: true,
      }),
    ).toBe(true);
    // Un organisateur destinataire de la liste ne voit pas l'élément en offreur : il ne décide pas.
    expect(
      canDecideBuyerRequest({
        ...base,
        level: 'none',
        now: late,
        organizers: [VIEWER],
        seenAsGiver: false,
      }),
    ).toBe(false);
    expect(
      canDecideBuyerRequest({
        ...base,
        level: 'giver',
        now: late,
        organizers: null,
        seenAsGiver: true,
      }),
    ).toBe(false);
  });
});

describe('VIS-37 : VIS-16 face à la surprise', () => {
  it('le blocage ne vaut que pour un auteur qui n’est pas destinataire de la liste', () => {
    for (const c of cases()) {
      if (c.detached || c.engagement !== 'none' || c.archived || c.closed) continue;
      const { list } = build(c);
      expect(engagementBlocksRuleChange(list, VIEWER)).toBe(!isRecipient(c));
    }
  });
});

describe('CPT-60 : liste hors événement', () => {
  it('participer reste possible sans événement ; une liste à la corbeille le ferme', () => {
    const c: Case = {
      type: 'WISHLIST',
      relation: 'circle',
      rule: 'ALL',
      suggestion: false,
      status: 'OPEN',
      existence: 'HIDDEN',
      content: 'NONE',
      engagement: 'none',
      detached: false,
      archived: false,
      closed: false,
    };
    const { list, item } = build(c);
    const free: ListFacts = { ...list, event: null };
    const access = listAccess(free, { profileId: VIEWER, inRecipientsCircle: true });
    expect(canContribute({ list: free, access, item }, VIEWER)).toBe(true);
    expect(accountingLevel({ list: free, access, item }, factsOf(c), VIEWER)).toBe('giver');
    const trashed: ListFacts = { ...free, deleted: true };
    expect(canContribute({ list: trashed, access, item }, VIEWER)).toBe(false);
  });
});

describe('CPT-73 : fiche détachée (revue SEC-40, I2)', () => {
  it('un participant relevé comme destinataire ou honoré au détachement n’a aucun accès', () => {
    const facts = { participants: [VIEWER, BUYER], buyerId: BUYER };
    expect(accountingLevel(null, { ...facts, excluded: [VIEWER] }, VIEWER)).toBe('none');
    expect(accountingLevel(null, { ...facts, excluded: [OTHER] }, VIEWER)).toBe('participant');
    expect(accountingLevel(null, facts, VIEWER)).toBe('participant');
  });
});
