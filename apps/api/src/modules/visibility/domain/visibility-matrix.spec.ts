import type {
  GiftContent,
  GiftExistence,
  ItemFacts,
  ItemStatus,
  ListAudience,
  ListFacts,
  ListRole,
  ListType,
  VisibilityMode,
} from './facts';
import { type ItemRecord, projectItem } from './projection';
import { type ItemAccess, itemAccess, itemCriteria, listAccess } from './rules';

// VIS-33 : matrice générée. Chaque combinaison (type de liste, relation du demandeur, audience,
// règle de l'élément, auteur, état, reçu, suggestion, réglages de giftlist, avant ou après la date
// de l'événement) a un résultat attendu, écrit ci-dessous à partir du texte de 03 et 04, sans
// reprendre le code du moteur. Écrite avant le moteur (QA-10).

const VIEWER = 'viewer';
const CO_RECIPIENT = 'co-recipient';
const RECIPIENT = 'recipient';
const OTHER = 'other';

/** Relation du demandeur à la liste. */
type Relation =
  | 'recipient' // destinataire (wishlist : membre créateur ; giftlist : jamais membre)
  | 'co_recipient' // second destinataire d'une liste partagée
  | 'creator_giver' // créateur non destinataire (parent qui tient la liste, créateur de giftlist)
  | 'owner'
  | 'contributor'
  | 'reader'
  | 'circle' // hors membres, dans le cercle d'un destinataire
  | 'same_account' // hors membres, du même compte qu'un destinataire (donc dans son cercle)
  | 'custom' // hors membres, choisi dans l'audience explicite
  | 'outsider';

type RuleCase = 'ALL' | 'ONLY_IN' | 'ONLY_OUT' | 'EXCEPT_IN' | 'EXCEPT_OUT';
type Author = 'viewer' | 'other' | 'deleted';

interface Case {
  type: ListType;
  relation: Relation;
  audience: ListAudience;
  rule: RuleCase;
  author: Author;
  status: ItemStatus;
  received: boolean;
  suggestion: boolean;
  existence: GiftExistence;
  content: GiftContent;
  shown: boolean;
  afterEvent: boolean;
}

const RELATIONS: Relation[] = [
  'recipient',
  'co_recipient',
  'creator_giver',
  'owner',
  'contributor',
  'reader',
  'circle',
  'same_account',
  'custom',
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
    case 'contributor':
      return 'CONTRIBUTOR';
    case 'reader':
      return 'READER';
    default:
      return null;
  }
}

function modeOf(rule: RuleCase): VisibilityMode {
  return rule === 'ALL' ? 'ALL' : rule.startsWith('ONLY') ? 'ONLY' : 'EXCEPT';
}

function build(c: Case): { list: ListFacts; item: ItemFacts; inCircle: boolean } {
  const isRecipient = c.relation === 'recipient' || c.relation === 'co_recipient';
  const recipients = isRecipient
    ? [VIEWER, c.relation === 'recipient' ? CO_RECIPIENT : RECIPIENT]
    : [RECIPIENT];
  const role = roleFor(c.relation, c.type);
  const members = [
    ...(role ? [{ profileId: VIEWER, role, since: new Date('2026-01-02') }] : []),
    // Le créateur est un autre profil quand le demandeur ne l'est pas.
    ...(role === 'CREATOR'
      ? []
      : [
          {
            profileId: c.type === 'WISHLIST' && !isRecipient ? RECIPIENT : OTHER,
            role: 'CREATOR' as const,
            since: new Date('2026-01-01'),
          },
        ]),
  ];
  const list: ListFacts = {
    id: 'list',
    type: c.type,
    audience: c.audience,
    recipients,
    members,
    customAudience: c.relation === 'custom' ? [VIEWER] : [],
    visibilityEditRole: 'CREATOR',
    giftExistence: c.existence,
    giftContent: c.content,
    personal: false,
    archived: false,
    deleted: false,
  };
  const ruleIncludesViewer = c.rule === 'ONLY_IN' || c.rule === 'EXCEPT_IN';
  const item: ItemFacts = {
    id: 'item',
    listId: 'list',
    rule: { mode: modeOf(c.rule), profiles: ruleIncludesViewer ? [VIEWER, OTHER] : [OTHER] },
    status: c.status,
    isSuggestion: c.suggestion,
    shownToRecipient: c.shown,
    addedBy: c.author === 'viewer' ? VIEWER : c.author === 'other' ? OTHER : null,
  };
  const inCircle = c.relation === 'circle' || c.relation === 'same_account';
  return { list, item, inCircle };
}

/** Le demandeur voit-il la liste comme offreur (audience, VIS-01 à VIS-03) ? */
function giverInAudience(c: Case): boolean {
  if (roleFor(c.relation, c.type) !== null) return true;
  if (c.relation === 'circle' || c.relation === 'same_account') return c.audience === 'CIRCLE';
  if (c.relation === 'custom') return c.audience === 'CUSTOM';
  return false;
}

/** VIS-10 : le demandeur est-il écarté par la règle ? */
function excluded(rule: RuleCase): boolean {
  return rule === 'ONLY_OUT' || rule === 'EXCEPT_IN';
}

/**
 * Résultat attendu, d'après la spec : règle de surprise d'abord (VIS-21), puis audience, puis
 * règle d'élément. La date de l'événement n'entre jamais en compte (LST-16).
 */
function expected(c: Case): ItemAccess {
  if (c.status === 'WITHDRAWN') return 'none'; // LST-19
  const isRecipient = c.relation === 'recipient' || c.relation === 'co_recipient';
  if (isRecipient && c.type === 'WISHLIST') {
    if (c.suggestion) return 'none'; // WSH-04
    if (c.author === 'viewer') return 'recipient'; // matrice : « Oui (c'est le sien) »
    return excluded(c.rule) ? 'none' : 'recipient'; // VIS-17
  }
  if (isRecipient && c.type === 'GIFTLIST') {
    if (c.existence === 'HIDDEN') return 'none'; // GFT-07
    if (c.content === 'NONE') return 'none';
    if (c.content === 'PARTIAL' && !c.shown) return 'none';
    return excluded(c.rule) ? 'none' : 'recipient'; // GFT-09
  }
  if (!giverInAudience(c)) return 'none'; // matrice : « Profil hors audience »
  if (c.author === 'viewer') return 'giver';
  return excluded(c.rule) ? 'none' : 'giver'; // matrice : « Souhait caché, exclu : Non »
}

function* cases(): Generator<Case> {
  const types: ListType[] = ['WISHLIST', 'GIFTLIST'];
  const audiences: ListAudience[] = ['MEMBERS', 'CIRCLE', 'EVENT', 'CUSTOM'];
  const rules: RuleCase[] = ['ALL', 'ONLY_IN', 'ONLY_OUT', 'EXCEPT_IN', 'EXCEPT_OUT'];
  const authors: Author[] = ['viewer', 'other', 'deleted'];
  const statuses: ItemStatus[] = ['OPEN', 'RESERVED', 'PURCHASED', 'WITHDRAWN'];
  const gifts: Array<[GiftExistence, GiftContent]> = [
    ['HIDDEN', 'NONE'],
    ['REVEALED', 'NONE'],
    ['REVEALED', 'PARTIAL'],
    ['REVEALED', 'FULL'],
  ];
  for (const type of types)
    for (const relation of RELATIONS)
      for (const audience of audiences)
        for (const rule of rules)
          for (const author of authors)
            for (const status of statuses)
              for (const received of [false, true])
                for (const suggestion of type === 'WISHLIST' ? [false, true] : [false])
                  for (const [existence, content] of type === 'GIFTLIST' ? gifts : [gifts[0]!])
                    for (const shown of type === 'GIFTLIST' ? [false, true] : [false])
                      for (const afterEvent of [false, true])
                        yield {
                          type,
                          relation,
                          audience,
                          rule,
                          author,
                          status,
                          received,
                          suggestion,
                          existence,
                          content,
                          shown,
                          afterEvent,
                        };
}

function record(c: Case, item: ItemFacts): ItemRecord {
  return {
    id: item.id,
    listId: item.listId,
    product: {
      id: 'product',
      title: 'Vélo',
      description: '',
      imageKey: null,
      merchant: null,
      sourceUrl: null,
    },
    quantity: 1,
    unitPriceMinor: 1999n,
    currency: 'EUR',
    priority: 'WANT',
    note: '',
    manyWelcome: false,
    position: 0,
    visibilityMode: item.rule.mode,
    visibilityProfiles: item.rule.profiles,
    status: item.status,
    isSuggestion: item.isSuggestion,
    shownToRecipient: item.shownToRecipient,
    receivedAt: c.received ? new Date('2026-12-26') : null,
    addedBy: item.addedBy,
    intendedRecipientId: null,
    createdAt: new Date('2026-11-01'),
    version: 1,
  };
}

const all = [...cases()];

describe('Matrice de visibilité générée (VIS-33)', () => {
  it(`couvre ${all.length} combinaisons`, () => {
    expect(all.length).toBeGreaterThan(10_000);
  });

  it('chaque combinaison donne le résultat attendu', () => {
    const failures: string[] = [];
    for (const c of all) {
      const { list, item, inCircle } = build(c);
      const access = listAccess(list, { profileId: VIEWER, inRecipientsCircle: inCircle });
      const got = itemAccess(access, item, VIEWER);
      const want = expected(c);
      if (got !== want) failures.push(`${JSON.stringify(c)} → ${got}, attendu ${want}`);
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it('VIS-20, VIS-22 : une vue destinataire ne porte jamais de donnée d’offreur, même nulle', () => {
    const forbidden = [
      'status',
      'isSuggestion',
      'shownToRecipient',
      'intendedRecipientId',
      'addedBy',
      'visibilityMode',
      'createdAt',
    ];
    for (const c of all) {
      const { list, item, inCircle } = build(c);
      const access = listAccess(list, { profileId: VIEWER, inRecipientsCircle: inCircle });
      const view = projectItem(itemAccess(access, item, VIEWER), record(c, item), VIEWER);
      if (view?.view !== 'recipient') continue;
      for (const key of forbidden) expect(Object.keys(view)).not.toContain(key);
    }
  });

  it('LST-16 : le destinataire voit le même état pour OUVERT, RÉSERVÉ et ACHETÉ ; seul le reçu diffère', () => {
    for (const c of all.filter((x) => x.relation === 'recipient' && x.type === 'WISHLIST')) {
      const { list, item } = build(c);
      const access = listAccess(list, { profileId: VIEWER, inRecipientsCircle: false });
      const views = (['OPEN', 'RESERVED', 'PURCHASED'] as const).map((status) =>
        projectItem(
          itemAccess(access, { ...item, status }, VIEWER),
          record(c, { ...item, status }),
          VIEWER,
        ),
      );
      expect(views[1]).toEqual(views[0]);
      expect(views[2]).toEqual(views[0]);
    }
  });

  it('LST-19 : un élément retiré n’a pas de vue, même projeté directement', () => {
    const c = all.find((x) => x.status === 'WITHDRAWN')!;
    const { item } = build(c);
    expect(projectItem('giver', record(c, item), VIEWER)).toBeNull();
    expect(projectItem('recipient', record(c, item), VIEWER)).toBeNull();
  });

  it('LST-16 : la date de l’événement ne change rien', () => {
    const key = (c: Case): string => JSON.stringify({ ...c, afterEvent: undefined });
    const byKey = new Map<string, ItemAccess>();
    for (const c of all) {
      const { list, item, inCircle } = build(c);
      const got = itemAccess(
        listAccess(list, { profileId: VIEWER, inRecipientsCircle: inCircle }),
        item,
        VIEWER,
      );
      const previous = byKey.get(key(c));
      if (previous !== undefined) expect(got).toBe(previous);
      byKey.set(key(c), got);
    }
  });

  it('VIS-31 : les critères de requête ne laissent jamais passer moins que le moteur', () => {
    for (const c of all) {
      const { list, item, inCircle } = build(c);
      const access = listAccess(list, { profileId: VIEWER, inRecipientsCircle: inCircle });
      const got = itemAccess(access, item, VIEWER);
      const criteria = itemCriteria(access, VIEWER);
      if (got === 'none') continue;
      // Tout élément montré doit passer les critères de la requête.
      expect(criteria).not.toBeNull();
      if (!criteria) continue;
      if (item.isSuggestion) expect(criteria.suggestions).toBe(true);
      if (criteria.shownOnly) expect(item.shownToRecipient).toBe(true);
      expect(item.status).not.toBe('WITHDRAWN');
    }
  });
});

describe('Matrice de référence de 04, ligne par ligne', () => {
  const at = (partial: Partial<Case>): ItemAccess => {
    const c: Case = {
      type: 'WISHLIST',
      relation: 'recipient',
      audience: 'CIRCLE',
      rule: 'ALL',
      author: 'viewer',
      status: 'RESERVED',
      received: false,
      suggestion: false,
      existence: 'HIDDEN',
      content: 'NONE',
      shown: false,
      afterEvent: false,
      ...partial,
    };
    const { list, item, inCircle } = build(c);
    return itemAccess(
      listAccess(list, { profileId: VIEWER, inRecipientsCircle: inCircle }),
      item,
      VIEWER,
    );
  };

  it('destinataire : tous ses souhaits, sans les réservations (vue destinataire)', () => {
    expect(at({ rule: 'ALL' })).toBe('recipient');
    expect(at({ rule: 'ONLY_IN' })).toBe('recipient');
    expect(at({ rule: 'EXCEPT_IN' })).toBe('recipient');
  });

  it('offreur dans l’audience : TOUS et caché autorisé oui, caché exclu non', () => {
    const base = { relation: 'circle' as const, author: 'other' as const };
    expect(at({ ...base, rule: 'ALL' })).toBe('giver');
    expect(at({ ...base, rule: 'ONLY_IN' })).toBe('giver');
    expect(at({ ...base, rule: 'EXCEPT_IN' })).toBe('none');
  });

  it('offreur du même compte que le destinataire : comme un autre offreur', () => {
    const base = { relation: 'same_account' as const, author: 'other' as const };
    expect(at({ ...base, rule: 'ALL' })).toBe('giver');
    expect(at({ ...base, rule: 'ONLY_OUT' })).toBe('none');
  });

  it('profil hors audience : rien', () => {
    expect(at({ relation: 'outsider', author: 'other' })).toBe('none');
    expect(at({ relation: 'circle', audience: 'MEMBERS', author: 'other' })).toBe('none');
  });

  it('destinataire d’une giftlist cachée : rien, quel que soit le contenu', () => {
    expect(
      at({ type: 'GIFTLIST', existence: 'HIDDEN', content: 'NONE', author: 'other', shown: true }),
    ).toBe('none');
  });

  it('VIS-15 : un profil arrivé dans l’audience voit TOUS SAUF, pas SEULEMENT', () => {
    const base = { relation: 'circle' as const, author: 'other' as const };
    expect(at({ ...base, rule: 'EXCEPT_OUT' })).toBe('giver');
    expect(at({ ...base, rule: 'ONLY_OUT' })).toBe('none');
  });
});
