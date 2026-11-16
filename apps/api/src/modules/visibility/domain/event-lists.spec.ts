import type { EventFacts, EventParticipantFact } from './events';
import type { ItemFacts, ListFacts, ListMemberFact, ListRole } from './facts';
import { type ItemRecord, projectItem } from './projection';
import {
  addRight,
  canActAsRecipient,
  canAttachList,
  canDetachList,
  canEditItem,
  canEditList,
  canMarkReceived,
  listAccess,
} from './rules';

// Listes et événements : clôture (EVT-38), reçu (LST-18, GFT-11), rattachement (EVT-29),
// reprise (EVT-27, EVT-28, VIS-35). Écrit avant le moteur (QA-10).

const ME = 'me';

function member(profileId: string, role: ListRole): ListMemberFact {
  return { profileId, role, since: new Date('2026-01-01') };
}

function list(partial: Partial<ListFacts> = {}): ListFacts {
  return {
    id: 'l',
    type: 'WISHLIST',
    audience: 'EVENT',
    recipients: [ME],
    members: [member(ME, 'CREATOR')],
    customAudience: [],
    visibilityEditRole: 'CREATOR',
    giftExistence: 'HIDDEN',
    giftContent: 'NONE',
    personal: false,
    archived: false,
    deleted: false,
    event: null,
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
    addedBy: ME,
    ...partial,
  };
}

const access = (l: ListFacts) => listAccess(l, { profileId: ME, inRecipientsCircle: false });
const closedEvent = { id: 'e', audience: [ME, 'giver'], closed: true, hiddenFrom: [] };
const openEvent = { id: 'e', audience: [ME, 'giver'], closed: false, hiddenFrom: [] };

describe('VIS-36, EVT-29 (revue SEC-40, I1) : liste rattachée à une surprise', () => {
  const surprise = { id: 'e', audience: ['giver'], closed: false, hiddenFrom: [ME] };
  it('jamais vue de l’honoré, quelle que soit l’audience, même membre', () => {
    const gift = (partial: Partial<ListFacts>) =>
      list({
        type: 'GIFTLIST',
        recipients: ['spouse'],
        members: [member('org', 'CREATOR')],
        event: surprise,
        ...partial,
      });
    expect(
      listAccess(gift({ audience: 'CIRCLE' }), { profileId: ME, inRecipientsCircle: true }).kind,
    ).toBe('none');
    expect(access(gift({ audience: 'CUSTOM', customAudience: [ME] })).kind).toBe('none');
    expect(access(gift({ members: [member('org', 'CREATOR'), member(ME, 'READER')] })).kind).toBe(
      'none',
    );
    expect(access(gift({ audience: 'EVENT' })).kind).toBe('none');
  });

  it('l’aperçu d’une giftlist révélée dont il est destinataire reste montré (GFT-09)', () => {
    const l = list({
      type: 'GIFTLIST',
      recipients: [ME],
      members: [member('org', 'CREATOR')],
      giftExistence: 'REVEALED',
      event: surprise,
    });
    expect(access(l)).toEqual({ kind: 'gift_recipient', content: 'NONE' });
  });

  it('les autres offreurs la voient toujours', () => {
    const l = list({
      type: 'GIFTLIST',
      audience: 'EVENT',
      recipients: ['spouse'],
      members: [member('org', 'CREATOR')],
      event: surprise,
    });
    expect(listAccess(l, { profileId: 'giver', inRecipientsCircle: false }).kind).toBe('giver');
  });
});

describe('EVT-38 : liste d’un événement clos en lecture seule, sauf le reçu', () => {
  it('le destinataire ne modifie plus, ne retire plus, mais coche encore « reçu »', () => {
    const l = list({ event: closedEvent });
    expect(canEditList(l, access(l))).toBe(false);
    expect(addRight(l, access(l))).toBe('none');
    expect(canEditItem(l, access(l), item(), ME)).toBe(false);
    expect(canActAsRecipient(l, access(l), item(), ME)).toBe(false);
    expect(canMarkReceived(l, access(l), item(), ME)).toBe(true);
  });

  it('un événement à venir ne change rien', () => {
    const l = list({ event: openEvent });
    expect(canEditList(l, access(l))).toBe(true);
    expect(canActAsRecipient(l, access(l), item(), ME)).toBe(true);
  });

  it('le reçu reste refusé sur une liste archivée ou à la corbeille', () => {
    expect(canMarkReceived(list({ archived: true }), access(list()), item(), ME)).toBe(false);
    const trashed = list({ deleted: true });
    expect(canMarkReceived(trashed, access(trashed), item(), ME)).toBe(false);
  });
});

describe('LST-18, GFT-11 : qui coche « reçu »', () => {
  it('wishlist : le destinataire seul, sur un souhait qu’il voit', () => {
    const l = list();
    expect(canMarkReceived(l, access(l), item(), ME)).toBe(true);
    expect(canMarkReceived(l, access(l), item({ isSuggestion: true, addedBy: 'g' }), ME)).toBe(
      false,
    );
    const giverList = list({ recipients: ['marie'], members: [member(ME, 'CREATOR')] });
    expect(canMarkReceived(giverList, access(giverList), item(), ME)).toBe(false);
  });

  const gift = (partial: Partial<ListFacts> = {}): ListFacts =>
    list({
      type: 'GIFTLIST',
      audience: 'MEMBERS',
      recipients: ['marie'],
      members: [member('creator', 'CREATOR')],
      ...partial,
    });

  it.each<[ListRole, boolean]>([
    ['CREATOR', true],
    ['OWNER', true],
    ['CONTRIBUTOR', false],
    ['READER', false],
  ])('giftlist : %s constate la remise : %s', (role, allowed) => {
    const l = gift({
      members:
        role === 'CREATOR' ? [member(ME, 'CREATOR')] : [member('c', 'CREATOR'), member(ME, role)],
    });
    expect(canMarkReceived(l, access(l), item({ addedBy: 'x' }), ME)).toBe(allowed);
  });

  it('giftlist : le destinataire, sur un élément qui lui est montré seulement', () => {
    const full = gift({ recipients: [ME], giftExistence: 'REVEALED', giftContent: 'FULL' });
    expect(canMarkReceived(full, access(full), item({ addedBy: 'x' }), ME)).toBe(true);
    const partial = gift({ recipients: [ME], giftExistence: 'REVEALED', giftContent: 'PARTIAL' });
    expect(canMarkReceived(partial, access(partial), item({ addedBy: 'x' }), ME)).toBe(false);
    expect(
      canMarkReceived(partial, access(partial), item({ addedBy: 'x', shownToRecipient: true }), ME),
    ).toBe(true);
    const hidden = gift({ recipients: [ME] });
    expect(canMarkReceived(hidden, access(hidden), item({ addedBy: 'x' }), ME)).toBe(false);
  });
});

describe('EVT-29 : rattacher et détacher une liste', () => {
  function participant(profileId: string, partial: Partial<EventParticipantFact> = {}) {
    return {
      profileId,
      role: 'PARTICIPANT' as const,
      isHonoree: false,
      rsvp: 'YES' as const,
      ...partial,
    };
  }
  const exchange = (partial: Partial<EventFacts> = {}): EventFacts => ({
    id: 'e',
    mode: 'EXCHANGE',
    isSurprise: false,
    status: 'UPCOMING',
    createdBy: 'org',
    datePassed: false,
    participants: [participant('org', { role: 'ORGANIZER' }), participant(ME)],
    ...partial,
  });

  it('échange : l’autorité participante rattache sa wishlist', () => {
    expect(canAttachList(list(), exchange(), ME)).toBe(true);
  });

  it('refusé : liste personnelle, archivée, à la corbeille, déjà rattachée', () => {
    expect(canAttachList(list({ personal: true }), exchange(), ME)).toBe(false);
    expect(canAttachList(list({ archived: true }), exchange(), ME)).toBe(false);
    expect(canAttachList(list({ deleted: true }), exchange(), ME)).toBe(false);
    expect(canAttachList(list({ event: openEvent }), exchange(), ME)).toBe(false);
  });

  it('refusé : pas l’autorité, réponse En attente ou Ne participe pas, événement clos', () => {
    expect(
      canAttachList(
        list({ members: [member('x', 'CREATOR'), member(ME, 'OWNER')] }),
        exchange(),
        ME,
      ),
    ).toBe(false);
    for (const rsvp of ['PENDING', 'NO'] as const) {
      expect(
        canAttachList(list(), exchange({ participants: [participant(ME, { rsvp })] }), ME),
      ).toBe(false);
    }
    expect(canAttachList(list(), exchange({ status: 'DONE' }), ME)).toBe(false);
    expect(canAttachList(list(), exchange({ participants: [participant('org')] }), ME)).toBe(false);
  });

  it('échange : chaque destinataire de la wishlist doit participer', () => {
    expect(canAttachList(list({ recipients: [ME, 'stranger'] }), exchange(), ME)).toBe(false);
  });

  it('à l’honneur : wishlists des seuls honorés, giftlists de tous', () => {
    const honoree = exchange({
      mode: 'HONOREE',
      participants: [participant('hon', { isHonoree: true }), participant(ME)],
    });
    expect(canAttachList(list(), honoree, ME)).toBe(false);
    const meHonored = exchange({
      mode: 'HONOREE',
      participants: [participant(ME, { isHonoree: true })],
    });
    expect(canAttachList(list(), meHonored, ME)).toBe(true);
    const gift = list({ type: 'GIFTLIST', recipients: ['hon'], audience: 'MEMBERS' });
    expect(canAttachList(gift, honoree, ME)).toBe(true);
    expect(
      // Surprise : l'honoré n'a pas de ligne ; seuls les offreurs participent.
      canAttachList(gift, { ...honoree, participants: [participant(ME)] }, ME),
    ).toBe(true);
  });

  it('détacher : l’autorité d’une liste rattachée', () => {
    expect(canDetachList(list({ event: openEvent }), ME)).toBe(true);
    expect(canDetachList(list(), ME)).toBe(false);
    // Revue SEC-40, M1 : jamais d'un événement clos (EVT-38).
    expect(canDetachList(list({ event: closedEvent }), ME)).toBe(false);
    expect(canDetachList(list({ event: openEvent, members: [member('x', 'CREATOR')] }), ME)).toBe(
      false,
    );
  });
});

describe('EVT-27, EVT-28, VIS-35 : reprise', () => {
  const record = (partial: Partial<ItemRecord> = {}): ItemRecord => ({
    id: 'i',
    listId: 'l',
    product: {
      id: 'p',
      title: 'Vélo',
      description: '',
      imageKey: null,
      merchant: null,
      sourceUrl: null,
    },
    quantity: 1,
    unitPriceMinor: 1999,
    currency: 'EUR',
    priority: 'WANT',
    note: '',
    manyWelcome: false,
    position: 0,
    visibilityMode: 'ALL',
    visibilityProfiles: [],
    status: 'OPEN',
    isSuggestion: false,
    shownToRecipient: false,
    receivedAt: null,
    addedBy: ME,
    intendedRecipientId: null,
    createdAt: new Date('2026-11-01'),
    version: 1,
    carriedForward: false,
    carryOrigin: null,
    ...partial,
  });
  const origin = (
    status: 'OPEN' | 'RESERVED' | 'PURCHASED',
    partial: {
      recipients?: string[];
      rule?: { mode: 'ALL' | 'ONLY' | 'EXCEPT'; profiles: string[] };
    } = {},
  ) => ({
    status,
    recipients: partial.recipients ?? [ME],
    rule: partial.rule ?? { mode: 'ALL' as const, profiles: [] },
    event: { id: 'noel-2025', title: 'Noël 2025', date: '2025-12-24' },
  });

  it('revue SEC-40, B1 : jamais à un destinataire de l’origine, ni à un profil que sa règle écartait', () => {
    const seen = { visibleEventIds: new Set(['noel-2025']) };
    // Co-destinataire de l'origine, offreur de la nouvelle liste.
    expect(
      projectItem(
        'giver',
        record({ carryOrigin: origin('PURCHASED', { recipients: [ME, 'co'] }) }),
        'co',
        seen,
      ),
    ).toMatchObject({ carriedFrom: null });
    expect(
      projectItem(
        'giver',
        record({
          carryOrigin: origin('PURCHASED', { rule: { mode: 'EXCEPT', profiles: ['g'] } }),
        }),
        'g',
        seen,
      ),
    ).toMatchObject({ carriedFrom: null });
  });

  it('vue destinataire : identique quel que soit l’état de l’origine ; pas de mention', () => {
    const views = (['OPEN', 'RESERVED', 'PURCHASED'] as const).map((status) =>
      projectItem('recipient', record({ carryOrigin: origin(status) }), ME),
    );
    expect(views[1]).toEqual(views[0]);
    expect(views[2]).toEqual(views[0]);
    expect(Object.keys(views[0]!)).not.toContain('carriedFrom');
  });

  it('vue destinataire : « reporté » est son propre geste, montré', () => {
    const view = projectItem('recipient', record({ carriedForward: true }), ME);
    expect(view).toMatchObject({ view: 'recipient', carriedForward: true });
  });

  it('vue offreur : mention si l’origine est réservée ou achetée, titre si l’événement est vu', () => {
    const seen = new Set(['noel-2025']);
    expect(
      projectItem('giver', record({ carryOrigin: origin('OPEN') }), 'g', { visibleEventIds: seen }),
    ).toMatchObject({ carriedFrom: null });
    expect(
      projectItem('giver', record({ carryOrigin: origin('PURCHASED') }), 'g', {
        visibleEventIds: seen,
      }),
    ).toMatchObject({
      carriedFrom: { status: 'PURCHASED', event: { title: 'Noël 2025', date: '2025-12-24' } },
    });
    expect(projectItem('giver', record({ carryOrigin: origin('RESERVED') }), 'g')).toMatchObject({
      carriedFrom: { status: 'RESERVED', event: null },
    });
    expect(projectItem('giver', record(), 'g')).toMatchObject({ carriedFrom: null });
  });
});
