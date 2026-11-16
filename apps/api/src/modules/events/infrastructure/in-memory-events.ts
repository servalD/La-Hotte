import type { EventRole, Rsvp } from '../../visibility';
import type {
  EventChanges,
  EventParticipantRecord,
  EventRecord,
  PersonCard,
} from '../domain/event';
import {
  type EventLinkRecord,
  EventLinkRepository,
  EventPeople,
  EventRepository,
  type NewEvent,
  type ProfileSettings,
  ResponseFloor,
} from '../domain/event.ports';

interface StoredParticipant extends EventParticipantRecord {
  readonly createdAt: number;
}

type StoredEvent = Omit<EventRecord, 'participants'> & {
  participants: StoredParticipant[];
  surprise: string[];
};

/** Double du dépôt : mêmes invariants que les déclencheurs de l'ADR 0017. */
export class InMemoryEventRepository extends EventRepository {
  readonly events = new Map<string, StoredEvent>();
  private tick = 0;

  /** Profils connus (relié par le banc de test au double d'`identity`). */
  cardOf: (profileId: string) => PersonCard | null = () => null;
  /** EVT-39 : détachement des listes, archivées si l'événement est clos (relié au double des listes). */
  detachLists: (eventId: string, archiveAt: Date | null) => void = () => undefined;
  /** EVT-34, EVT-39 : révocation des liens (relié au double des liens). */
  revokeLinks: (eventId: string, at: Date) => void = () => undefined;

  private record(row: StoredEvent): EventRecord {
    const { surprise: _surprise, participants, ...rest } = row;
    return {
      ...rest,
      participants: [...participants]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(({ createdAt: _createdAt, ...participant }) => participant),
    };
  }

  private stamp(): number {
    this.tick += 1;
    return this.tick;
  }

  create(event: NewEvent): Promise<EventRecord | 'conflict'> {
    const surprise = event.surpriseRecipients.map((r) => r.profileId);
    if (event.participants.some((p) => surprise.includes(p.profileId))) {
      return Promise.resolve('conflict');
    }
    const row: StoredEvent = {
      id: event.id,
      title: event.title,
      date: event.date,
      timezone: event.timezone,
      place: event.place,
      description: event.description,
      type: event.type,
      mode: event.mode,
      isSurprise: event.isSurprise,
      suggestedBudgetMinor: event.suggestedBudgetMinor,
      currency: event.currency,
      status: 'UPCOMING',
      createdBy: event.createdBy,
      recreatedFromId: event.recreatedFromId,
      createdAt: event.now,
      version: 1,
      participants: event.participants.map((p) => ({
        profileId: p.profileId,
        role: p.role,
        isHonoree: p.isHonoree,
        rsvp: p.rsvp,
        respondedAt: p.rsvp === 'PENDING' ? null : event.now,
        createdAt: this.stamp(),
      })),
      surprise,
    };
    this.events.set(row.id, row);
    return Promise.resolve(this.record(row));
  }

  find(eventId: string): Promise<EventRecord | null> {
    const row = this.events.get(eventId);
    return Promise.resolve(row ? this.record(row) : null);
  }

  findForProfile(profileId: string): Promise<EventRecord[]> {
    return Promise.resolve(
      [...this.events.values()]
        .filter((row) => row.participants.some((p) => p.profileId === profileId))
        .map((row) => this.record(row)),
    );
  }

  update(input: {
    eventId: string;
    expectedVersion: number;
    changes: EventChanges;
  }): Promise<EventRecord | 'version' | 'missing'> {
    const row = this.events.get(input.eventId);
    if (!row) return Promise.resolve('missing');
    if (row.version !== input.expectedVersion) return Promise.resolve('version');
    const next = { ...row, ...input.changes, version: row.version + 1 };
    this.events.set(row.id, next);
    return Promise.resolve(this.record(next));
  }

  cancel(eventId: string, at: Date): Promise<void> {
    const row = this.events.get(eventId);
    if (row?.status === 'UPCOMING') {
      this.events.set(eventId, { ...row, status: 'CANCELLED', version: row.version + 1 });
    }
    this.revokeLinks(eventId, at);
    return Promise.resolve();
  }

  delete(eventId: string, at: Date, archiveLists: boolean): Promise<void> {
    this.detachLists(eventId, archiveLists ? at : null);
    this.revokeLinks(eventId, at);
    this.events.delete(eventId);
    return Promise.resolve();
  }

  addParticipants(input: {
    eventId: string;
    invitedBy: string;
    rows: readonly { id: string; profileId: string }[];
  }): Promise<{ readonly added: readonly string[] } | 'surprise_honoree'> {
    const row = this.events.get(input.eventId);
    if (!row) return Promise.resolve({ added: [] });
    if (input.rows.some((r) => row.surprise.includes(r.profileId))) {
      return Promise.resolve('surprise_honoree');
    }
    const added: string[] = [];
    for (const { profileId } of input.rows) {
      if (row.participants.some((p) => p.profileId === profileId)) continue;
      row.participants.push({
        profileId,
        role: 'PARTICIPANT',
        isHonoree: false,
        rsvp: 'PENDING',
        respondedAt: null,
        createdAt: this.stamp(),
      });
      added.push(profileId);
    }
    return Promise.resolve({ added });
  }

  removeParticipant(eventId: string, profileId: string): Promise<boolean> {
    const row = this.events.get(eventId);
    if (!row) return Promise.resolve(false);
    const before = row.participants.length;
    row.participants = row.participants.filter((p) => p.profileId !== profileId);
    return Promise.resolve(row.participants.length < before);
  }

  private patch(
    eventId: string,
    profileId: string,
    change: Partial<StoredParticipant>,
  ): Promise<boolean> {
    const row = this.events.get(eventId);
    if (!row) return Promise.resolve(false);
    let found = false;
    row.participants = row.participants.map((p) => {
      if (p.profileId !== profileId) return p;
      found = true;
      return { ...p, ...change };
    });
    return Promise.resolve(found);
  }

  setRole(eventId: string, profileId: string, role: EventRole): Promise<boolean> {
    return this.patch(eventId, profileId, { role });
  }

  setRsvp(eventId: string, profileId: string, rsvp: Rsvp, at: Date): Promise<boolean> {
    return this.patch(eventId, profileId, { rsvp, respondedAt: at });
  }

  addHonorees(input: {
    eventId: string;
    surprise: boolean;
    invitedBy: string;
    rows: readonly { id: string; profileId: string }[];
  }): Promise<'ok' | 'conflict'> {
    const row = this.events.get(input.eventId);
    if (!row) return Promise.resolve('ok');
    const ids = input.rows.map((r) => r.profileId);
    if (input.surprise) {
      if (row.participants.some((p) => ids.includes(p.profileId))) {
        return Promise.resolve('conflict');
      }
      for (const id of ids) if (!row.surprise.includes(id)) row.surprise.push(id);
      return Promise.resolve('ok');
    }
    for (const id of ids) {
      if (row.participants.some((p) => p.profileId === id)) {
        row.participants = row.participants.map((p) =>
          p.profileId === id ? { ...p, isHonoree: true } : p,
        );
      } else {
        row.participants.push({
          profileId: id,
          role: 'PARTICIPANT',
          isHonoree: true,
          rsvp: 'PENDING',
          respondedAt: null,
          createdAt: this.stamp(),
        });
      }
    }
    return Promise.resolve('ok');
  }

  surpriseRecipients(eventId: string): Promise<string[]> {
    return Promise.resolve([...(this.events.get(eventId)?.surprise ?? [])]);
  }

  cards(profileIds: readonly string[]): Promise<PersonCard[]> {
    return Promise.resolve(
      profileIds.flatMap((id) => {
        const card = this.cardOf(id);
        return card ? [card] : [];
      }),
    );
  }

  upcomingBefore(day: string): Promise<EventRecord[]> {
    return Promise.resolve(
      [...this.events.values()]
        .filter((row) => row.status === 'UPCOMING' && row.date < day)
        .map((row) => this.record(row)),
    );
  }

  markDone(eventId: string): Promise<void> {
    const row = this.events.get(eventId);
    if (row?.status === 'UPCOMING') this.events.set(eventId, { ...row, status: 'DONE' });
    return Promise.resolve();
  }

  /** Préparation des tests : déplace la date ou le statut d'un événement. */
  force(eventId: string, change: Partial<Pick<StoredEvent, 'date' | 'status'>>): void {
    const row = this.events.get(eventId);
    if (row) this.events.set(eventId, { ...row, ...change });
  }
}

interface StoredLink extends EventLinkRecord {
  readonly tokenHash: string;
  revokedAt: Date | null;
}

export class InMemoryEventLinkRepository extends EventLinkRepository {
  readonly links = new Map<string, StoredLink>();

  constructor(private readonly events: InMemoryEventRepository) {
    super();
  }

  private open(link: StoredLink, now: Date): boolean {
    return link.revokedAt === null && link.expiresAt > now && link.usedCount < link.maxUses;
  }

  private record({ tokenHash: _hash, revokedAt: _revoked, ...link }: StoredLink): EventLinkRecord {
    return link;
  }

  create(input: {
    id: string;
    eventId: string;
    createdBy: string;
    tokenHash: string;
    maxUses: number;
    expiresAt: Date;
  }): Promise<EventLinkRecord> {
    const link: StoredLink = {
      ...input,
      usedCount: 0,
      createdAt: new Date(),
      revokedAt: null,
    };
    this.links.set(link.id, link);
    return Promise.resolve(this.record(link));
  }

  listOpen(eventId: string, now: Date): Promise<EventLinkRecord[]> {
    return Promise.resolve(
      [...this.links.values()]
        .filter((link) => link.eventId === eventId && this.open(link, now))
        .map((link) => this.record(link)),
    );
  }

  revoke(eventId: string, linkId: string, now: Date): Promise<boolean> {
    const link = this.links.get(linkId);
    if (!link || link.eventId !== eventId || link.revokedAt) return Promise.resolve(false);
    link.revokedAt = now;
    return Promise.resolve(true);
  }

  revokeCreatedBy(eventId: string, profileId: string, now: Date): Promise<void> {
    for (const link of this.links.values()) {
      if (link.eventId === eventId && link.createdBy === profileId && !link.revokedAt) {
        link.revokedAt = now;
      }
    }
    return Promise.resolve();
  }

  revokeAll(eventId: string, at: Date): void {
    for (const link of this.links.values()) {
      if (link.eventId === eventId && !link.revokedAt) link.revokedAt = at;
    }
  }

  findLive(tokenHash: string, now: Date): Promise<EventLinkRecord | null> {
    const link = [...this.links.values()].find((l) => l.tokenHash === tokenHash);
    const live = link && link.revokedAt === null && link.expiresAt > now;
    return Promise.resolve(live ? this.record(link) : null);
  }

  async redeem(input: {
    linkId: string;
    eventId: string;
    profileId: string;
    participantId: string;
    now: Date;
  }): Promise<'joined' | 'already' | 'invalid'> {
    const event = this.events.events.get(input.eventId);
    const link = this.links.get(input.linkId);
    if (!event || !link) return 'invalid';
    if (event.participants.some((p) => p.profileId === input.profileId)) return 'already';
    if (event.surprise.includes(input.profileId) || !this.open(link, input.now)) return 'invalid';
    this.links.set(link.id, { ...link, usedCount: link.usedCount + 1 });
    await this.events.addParticipants({
      eventId: input.eventId,
      invitedBy: link.createdBy,
      rows: [{ id: input.participantId, profileId: input.profileId }],
    });
    return 'joined';
  }
}

export class InMemoryEventPeople extends EventPeople {
  /** Reliés par le banc de test aux doubles d'`identity`. */
  settingsOf: (profileId: string) => ProfileSettings | null = () => null;
  blocked: (a: string, b: string) => Promise<boolean> = () => Promise.resolve(false);

  settings(profileId: string): Promise<ProfileSettings | null> {
    return Promise.resolve(this.settingsOf(profileId));
  }

  async blockedWithAny(profileId: string, others: readonly string[]): Promise<boolean> {
    for (const other of others) if (await this.blocked(profileId, other)) return true;
    return false;
  }
}

/** Sans attente ; compte les refus passés par le plancher (EVT-16). */
export class RecordingResponseFloor extends ResponseFloor {
  pads = 0;

  pad(): Promise<void> {
    this.pads += 1;
    return Promise.resolve();
  }
}
