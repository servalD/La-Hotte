import type { EventFacts, EventMode, EventRole, EventStatus, Rsvp } from './events';
import {
  canAddHonoree,
  canCancelEvent,
  canCreateInviteLink,
  canDeleteEvent,
  canEditEvent,
  canInvite,
  canManageInviteLinks,
  canNameOrganizer,
  canRecreateEvent,
  canRemoveParticipant,
  canRespond,
  canRevokeOrganizer,
  eventAccess,
  eventListAudience,
  isEventClosed,
} from './events';

// VIS-33, VIS-36 : matrice générée des événements, écrite avant le moteur (QA-10) à partir du texte
// de 05 (EVT-03, EVT-06 à EVT-09, EVT-13 à EVT-18, EVT-33, EVT-34, EVT-38 à EVT-40).

const VIEWER = 'viewer';
const CREATOR = 'creator';
const OTHER = 'other';

/** Relation du demandeur à l'événement. */
type Relation =
  | 'creator' // créateur, organisateur
  | 'organizer' // organisateur nommé
  | 'participant'
  | 'honoree' // honoré participant (à l'honneur, hors surprise)
  | 'surprise_honoree' // honoré d'une surprise : jamais de ligne de participant (EVT-07)
  | 'outsider';

interface Case {
  mode: EventMode;
  surprise: boolean;
  relation: Relation;
  rsvp: Rsvp;
  status: EventStatus;
  datePassed: boolean;
  child: boolean;
}

function participates(c: Case): boolean {
  return c.relation !== 'surprise_honoree' && c.relation !== 'outsider';
}

function build(c: Case): EventFacts {
  const viewerRole: EventRole =
    c.relation === 'creator' || c.relation === 'organizer' ? 'ORGANIZER' : 'PARTICIPANT';
  const participants = [
    ...(c.relation === 'creator'
      ? []
      : [
          {
            profileId: CREATOR,
            role: 'ORGANIZER' as const,
            isHonoree: false,
            rsvp: 'YES' as const,
          },
        ]),
    { profileId: OTHER, role: 'PARTICIPANT' as const, isHonoree: false, rsvp: 'YES' as const },
    ...(participates(c)
      ? [
          {
            profileId: VIEWER,
            role: viewerRole,
            isHonoree: c.relation === 'honoree',
            rsvp: c.rsvp,
          },
        ]
      : []),
  ];
  return {
    id: 'event',
    mode: c.mode,
    isSurprise: c.surprise,
    status: c.status,
    createdBy: c.relation === 'creator' ? VIEWER : CREATOR,
    participants,
    datePassed: c.datePassed,
  };
}

/** Combinaisons possibles (EVT-07, EVT-09) : honoré participant seulement « à l'honneur » hors surprise, etc. */
function possible(c: Case): boolean {
  if (c.surprise && c.mode !== 'HONOREE') return false;
  if (c.relation === 'honoree' && (c.mode !== 'HONOREE' || c.surprise)) return false;
  if (c.relation === 'surprise_honoree' && !c.surprise) return false;
  if (!participates(c) && c.rsvp !== 'PENDING') return false;
  return true;
}

function* cases(): Generator<Case> {
  const relations: Relation[] = [
    'creator',
    'organizer',
    'participant',
    'honoree',
    'surprise_honoree',
    'outsider',
  ];
  for (const mode of ['EXCHANGE', 'HONOREE'] as const)
    for (const surprise of [false, true])
      for (const relation of relations)
        for (const rsvp of ['PENDING', 'YES', 'MAYBE', 'NO'] as const)
          for (const status of ['UPCOMING', 'DONE', 'CANCELLED'] as const)
            for (const datePassed of [false, true])
              for (const child of [false, true]) {
                const c = { mode, surprise, relation, rsvp, status, datePassed, child };
                if (possible(c)) yield c;
              }
}

const all = [...cases()];

const organizer = (c: Case): boolean => c.relation === 'creator' || c.relation === 'organizer';
/** EVT-05, EVT-18, EVT-39 : modifiable tant qu'à venir et que la date n'est pas passée. */
const open = (c: Case): boolean => c.status === 'UPCOMING' && !c.datePassed;

describe('Matrice des événements générée (VIS-33, VIS-36)', () => {
  it(`couvre ${all.length} combinaisons`, () => {
    expect(all.length).toBeGreaterThan(400);
  });

  it('EVT-08 : seule une ligne de participant donne accès, quelle que soit la réponse', () => {
    for (const c of all) {
      const access = eventAccess(build(c), VIEWER);
      expect({ c, kind: access.kind }).toEqual({
        c,
        kind: participates(c) ? 'participant' : 'none',
      });
    }
  });

  it('EVT-07 : l’honoré d’une surprise n’a jamais accès ni aucun droit', () => {
    for (const c of all.filter((x) => x.relation === 'surprise_honoree')) {
      const event = build(c);
      const access = eventAccess(event, VIEWER);
      expect(access.kind).toBe('none');
      expect(canRespond(event, access)).toBe(false);
      expect(canInvite(event, access)).toBe(false);
      expect(canDeleteEvent(event, VIEWER)).toBe(false);
      expect(eventListAudience(event)).not.toContain(VIEWER);
    }
  });

  it('EVT-14 : l’audience des listes = participants qui ont répondu Participe ou Peut-être', () => {
    for (const c of all) {
      const inAudience = participates(c) && (c.rsvp === 'YES' || c.rsvp === 'MAYBE');
      expect(eventListAudience(build(c)).includes(VIEWER)).toBe(inAudience);
    }
  });

  it('EVT-38 : terminé ou annulé = clos', () => {
    for (const c of all) expect(isEventClosed(build(c))).toBe(c.status !== 'UPCOMING');
  });

  it('chaque permission donne le résultat attendu', () => {
    const failures: string[] = [];
    const check = (c: Case, name: string, got: boolean, want: boolean): void => {
      if (got !== want) failures.push(`${name} ${JSON.stringify(c)} → ${got}, attendu ${want}`);
    };
    for (const c of all) {
      const event = build(c);
      const access = eventAccess(event, VIEWER);
      const org = organizer(c);
      // EVT-03, EVT-39 : les organisateurs modifient, le créateur seul supprime.
      check(c, 'edit', canEditEvent(event, access), org && open(c));
      check(c, 'delete', canDeleteEvent(event, VIEWER), c.relation === 'creator');
      // EVT-34 : annulation d'un événement à venir.
      check(c, 'cancel', canCancelEvent(event, access), org && c.status === 'UPCOMING');
      // EVT-15, EVT-16 : inviter ; un profil enfant ne crée pas de lien.
      check(c, 'invite', canInvite(event, access), org && open(c));
      check(c, 'link', canCreateInviteLink(event, access, c.child), org && open(c) && !c.child);
      check(c, 'manage links', canManageInviteLinks(access), org);
      // EVT-07 : honorés ajoutés « à l'honneur ».
      check(c, 'honoree', canAddHonoree(event, access), org && open(c) && c.mode === 'HONOREE');
      // EVT-13, EVT-18 : réponse jusqu'à la fin de la date, figée ensuite et à l'annulation.
      check(c, 'respond', canRespond(event, access), participates(c) && open(c));
      // EVT-40 : recréation d'un événement passé ou clos.
      check(
        c,
        'recreate',
        canRecreateEvent(event, access),
        org && (c.status !== 'UPCOMING' || c.datePassed),
      );
      // EVT-17 : retrait d'un autre participant, jamais du créateur.
      check(
        c,
        'remove other',
        canRemoveParticipant(event, access, OTHER),
        org && c.status === 'UPCOMING',
      );
      check(c, 'remove creator', canRemoveParticipant(event, access, CREATOR), false);
      // EVT-06 : nommer un participant organisateur ; seul le créateur retire le rôle.
      check(
        c,
        'name organizer',
        canNameOrganizer(event, access, OTHER),
        org && c.status === 'UPCOMING',
      );
      check(c, 'revoke organizer', canRevokeOrganizer(event, VIEWER, OTHER), false);
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });
});

describe('Organisateurs (EVT-06)', () => {
  const base: EventFacts = {
    id: 'e',
    mode: 'HONOREE',
    isSurprise: false,
    status: 'UPCOMING',
    createdBy: CREATOR,
    datePassed: false,
    participants: [
      { profileId: CREATOR, role: 'ORGANIZER', isHonoree: false, rsvp: 'YES' },
      { profileId: 'org', role: 'ORGANIZER', isHonoree: false, rsvp: 'YES' },
      { profileId: 'hon', role: 'PARTICIPANT', isHonoree: true, rsvp: 'YES' },
      { profileId: OTHER, role: 'PARTICIPANT', isHonoree: false, rsvp: 'NO' },
    ],
  };

  it('le créateur seul retire le rôle, jamais à lui-même', () => {
    expect(canRevokeOrganizer(base, CREATOR, 'org')).toBe(true);
    expect(canRevokeOrganizer(base, 'org', CREATOR)).toBe(false);
    expect(canRevokeOrganizer(base, CREATOR, CREATOR)).toBe(false);
    expect(canRevokeOrganizer(base, CREATOR, OTHER)).toBe(false); // pas organisateur
  });

  it('un honoré n’est pas nommé organisateur ; un inconnu non plus', () => {
    const access = eventAccess(base, 'org');
    expect(canNameOrganizer(base, access, 'hon')).toBe(false);
    expect(canNameOrganizer(base, access, 'stranger')).toBe(false);
    expect(canNameOrganizer(base, access, OTHER)).toBe(true);
    expect(canNameOrganizer(base, access, CREATOR)).toBe(false); // déjà organisateur
  });

  it('retirer un profil qui n’est pas participant est refusé', () => {
    expect(canRemoveParticipant(base, eventAccess(base, CREATOR), 'stranger')).toBe(false);
  });

  it('un créateur dont le profil a été supprimé ne bloque rien', () => {
    const orphan: EventFacts = {
      ...base,
      createdBy: null,
      participants: base.participants.filter((p) => p.profileId !== CREATOR),
    };
    expect(canDeleteEvent(orphan, 'org')).toBe(false);
    expect(canRemoveParticipant(orphan, eventAccess(orphan, 'org'), OTHER)).toBe(true);
  });
});
