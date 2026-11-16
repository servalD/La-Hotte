import {
  type ChannelPreference,
  DEFAULT_SETTINGS,
  type NotificationRecord,
  type NotificationSettings,
} from '../domain/notification';
import {
  DeliveryGateway,
  type DigestCandidate,
  DigestRepository,
  type NewNotification,
  NotificationPeople,
  NotificationRepository,
  PreferenceRepository,
  PushSender,
  PushSubscriptionRepository,
} from '../domain/notification.ports';
import { PUSH_DEVICES_PER_PROFILE, type PushDevice, type PushPayload } from '../domain/push';

export class InMemoryNotificationRepository extends NotificationRepository {
  readonly rows = new Map<string, NotificationRecord>();
  readonly counters = new Map<string, number>();

  private of(profileId: string): NotificationRecord[] {
    return [...this.rows.values()].filter((row) => row.profileId === profileId);
  }

  create(n: NewNotification): Promise<NotificationRecord> {
    const seq = (this.counters.get(n.profileId) ?? 0) + 1;
    this.counters.set(n.profileId, seq);
    const record: NotificationRecord = {
      id: n.id,
      profileId: n.profileId,
      seq,
      type: n.type,
      category: n.category,
      subject: n.subject,
      commentId: n.commentId,
      actorId: n.actorId,
      readAt: null,
      pushDueAt: n.pushDueAt,
      pushSentAt: null,
      createdAt: n.at,
    };
    this.rows.set(record.id, record);
    return Promise.resolve(record);
  }

  page(profileId: string, beforeSeq: number | null, limit: number) {
    return Promise.resolve(
      this.of(profileId)
        .filter((row) => beforeSeq === null || row.seq < beforeSeq)
        .sort((a, b) => b.seq - a.seq)
        .slice(0, limit),
    );
  }

  after(profileId: string, afterSeq: number, limit: number) {
    return Promise.resolve(
      this.of(profileId)
        .filter((row) => row.seq > afterSeq)
        .sort((a, b) => a.seq - b.seq)
        .slice(0, limit),
    );
  }

  lastSeq(profileId: string): Promise<number> {
    return Promise.resolve(this.counters.get(profileId) ?? 0);
  }

  firstSeq(profileId: string): Promise<number | null> {
    const seqs = this.of(profileId).map((row) => row.seq);
    return Promise.resolve(seqs.length === 0 ? null : Math.min(...seqs));
  }

  unread(profileId: string, limit: number) {
    return Promise.resolve(
      this.of(profileId)
        .filter((row) => row.readAt === null)
        .sort((a, b) => b.seq - a.seq)
        .slice(0, limit),
    );
  }

  markRead(
    profileId: string,
    target: { readonly ids: readonly string[] } | { readonly upToSeq: number },
    at: Date,
  ): Promise<void> {
    for (const row of this.of(profileId)) {
      if (row.readAt) continue;
      const hit = 'ids' in target ? target.ids.includes(row.id) : row.seq <= target.upToSeq;
      if (hit) this.rows.set(row.id, { ...row, readAt: at });
    }
    return Promise.resolve();
  }

  purgeBefore(before: Date): Promise<number> {
    let count = 0;
    for (const row of [...this.rows.values()]) {
      if (row.createdAt < before) {
        this.rows.delete(row.id);
        count += 1;
      }
    }
    return Promise.resolve(count);
  }

  /** Notifications d'un profil, les plus récentes d'abord (tests). */
  forProfile(profileId: string): NotificationRecord[] {
    return this.of(profileId).sort((a, b) => b.seq - a.seq);
  }
}

export class InMemoryPreferenceRepository extends PreferenceRepository {
  readonly prefs = new Map<string, ChannelPreference[]>();
  readonly stored = new Map<string, NotificationSettings>();

  overrides(profileId: string): Promise<ChannelPreference[]> {
    return Promise.resolve([...(this.prefs.get(profileId) ?? [])]);
  }

  settings(profileId: string): Promise<NotificationSettings> {
    return Promise.resolve(this.stored.get(profileId) ?? DEFAULT_SETTINGS);
  }

  save(input: {
    profileId: string;
    overrides: readonly ChannelPreference[];
    settings: NotificationSettings;
  }): Promise<void> {
    this.prefs.set(input.profileId, [...input.overrides]);
    this.stored.set(input.profileId, input.settings);
    return Promise.resolve();
  }
}

/** Relié par le banc de test aux profils du double d'`identity`. */
export class InMemoryNotificationPeople extends NotificationPeople {
  timezone: (profileId: string) => string | null = () => 'Europe/Paris';
  accountProfiles: (accountId: string) => string[] = () => [];
  nameOf: (profileId: string) => string | null = () => null;

  timezoneOf(profileId: string): Promise<string | null> {
    return Promise.resolve(this.timezone(profileId));
  }

  profilesOfAccount(accountId: string): Promise<string[]> {
    return Promise.resolve(this.accountProfiles(accountId));
  }

  names(profileIds: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const id of profileIds) {
      const name = this.nameOf(id);
      if (name) out.set(id, name);
    }
    return Promise.resolve(out);
  }
}

/** NOT-15 : appareils, et réclamation des push dues dans le double des notifications. */
export class InMemoryPushSubscriptionRepository extends PushSubscriptionRepository {
  readonly devices = new Map<
    string,
    { id: string; sessionId: string; endpoint: string; p256dh: string; auth: string }
  >();
  readonly links = new Map<
    string,
    { subscriptionId: string; profileId: string; showDetails: boolean }
  >();

  constructor(private readonly notifications: InMemoryNotificationRepository) {
    super();
  }

  register(input: {
    id: string;
    sessionId: string;
    profileId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    showDetails: boolean;
  }): Promise<'ok' | 'limit'> {
    const existing = [...this.devices.values()].find((d) => d.endpoint === input.endpoint);
    const others = [...this.links.values()].filter(
      (l) => l.profileId === input.profileId && l.subscriptionId !== existing?.id,
    );
    if (others.length >= PUSH_DEVICES_PER_PROFILE) return Promise.resolve('limit');
    const id = existing?.id ?? input.id;
    if (existing && existing.sessionId !== input.sessionId) {
      for (const [key, link] of this.links) if (link.subscriptionId === id) this.links.delete(key);
    }
    this.devices.set(id, {
      id,
      sessionId: input.sessionId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
    });
    this.links.set(`${id}|${input.profileId}`, {
      subscriptionId: id,
      profileId: input.profileId,
      showDetails: input.showDetails,
    });
    return Promise.resolve('ok');
  }

  unregister(input: { sessionId: string; profileId: string; endpoint: string }): Promise<void> {
    const device = [...this.devices.values()].find((d) => d.endpoint === input.endpoint);
    if (!device || device.sessionId !== input.sessionId) return Promise.resolve();
    this.links.delete(`${device.id}|${input.profileId}`);
    if (![...this.links.values()].some((l) => l.subscriptionId === device.id)) {
      this.devices.delete(device.id);
    }
    return Promise.resolve();
  }

  setDetails(input: {
    sessionId: string;
    profileId: string;
    endpoint: string;
    showDetails: boolean;
  }): Promise<boolean> {
    const device = [...this.devices.values()].find((d) => d.endpoint === input.endpoint);
    const link = device ? this.links.get(`${device.id}|${input.profileId}`) : undefined;
    if (!device || !link || device.sessionId !== input.sessionId) return Promise.resolve(false);
    this.links.set(`${device.id}|${input.profileId}`, { ...link, showDetails: input.showDetails });
    return Promise.resolve(true);
  }

  devicesOf(profileId: string): Promise<PushDevice[]> {
    return Promise.resolve(
      [...this.links.values()]
        .filter((l) => l.profileId === profileId)
        .flatMap((l) => {
          const d = this.devices.get(l.subscriptionId);
          return d
            ? [
                {
                  subscriptionId: d.id,
                  sessionId: d.sessionId,
                  endpoint: d.endpoint,
                  p256dh: d.p256dh,
                  auth: d.auth,
                  showDetails: l.showDetails,
                },
              ]
            : [];
        }),
    );
  }

  remove(subscriptionId: string): Promise<void> {
    this.devices.delete(subscriptionId);
    for (const [key, link] of this.links)
      if (link.subscriptionId === subscriptionId) this.links.delete(key);
    return Promise.resolve();
  }

  claimDue(now: Date, limit: number): Promise<NotificationRecord[]> {
    const due = [...this.notifications.rows.values()]
      .filter((r) => r.pushDueAt && r.pushDueAt <= now && !r.pushSentAt && !r.readAt)
      .slice(0, limit);
    for (const row of due) this.notifications.rows.set(row.id, { ...row, pushSentAt: now });
    return Promise.resolve(due);
  }
}

/** Push envoyées, en mémoire ; `gone` simule un appareil désabonné. */
export class RecordingPushSender extends PushSender {
  readonly sent: { endpoint: string; payload: PushPayload }[] = [];
  readonly gone = new Set<string>();
  configured = true;

  enabled(): boolean {
    return this.configured;
  }

  publicKey(): string | null {
    return this.configured ? 'B'.repeat(87) : null;
  }

  send(device: PushDevice, payload: PushPayload): Promise<'ok' | 'gone' | 'error'> {
    if (this.gone.has(device.endpoint)) return Promise.resolve('gone');
    this.sent.push({ endpoint: device.endpoint, payload });
    return Promise.resolve('ok');
  }
}

export class InMemoryDeliveryGateway extends DeliveryGateway {
  alive: (sessionId: string) => boolean = () => true;
  readonly digests: { accountId: string; entries: { profileName: string; count: number }[] }[] = [];

  sessionAlive(sessionId: string): Promise<boolean> {
    return Promise.resolve(this.alive(sessionId));
  }

  sendDigest(
    accountId: string,
    entries: readonly { profileName: string; count: number }[],
  ): Promise<boolean> {
    this.digests.push({ accountId, entries: [...entries] });
    return Promise.resolve(true);
  }
}

export class InMemoryDigestRepository extends DigestRepository {
  readonly digested = new Map<string, Date>();
  profile: (profileId: string) => { accountId: string; name: string } | null = () => null;

  constructor(
    private readonly notifications: InMemoryNotificationRepository,
    private readonly preferences: InMemoryPreferenceRepository,
  ) {
    super();
  }

  async candidates(since: Date): Promise<DigestCandidate[]> {
    const ids = new Set(
      [...this.notifications.rows.values()]
        .filter((r) => !r.readAt && r.createdAt >= since)
        .map((r) => r.profileId),
    );
    const out: DigestCandidate[] = [];
    for (const profileId of ids) {
      const who = this.profile(profileId);
      if (!who) continue;
      const settings = await this.preferences.settings(profileId);
      out.push({
        profileId,
        accountId: who.accountId,
        profileName: who.name,
        digest: settings.digest,
        lastDigestAt: this.digested.get(profileId) ?? null,
      });
    }
    return out;
  }

  unreadSince(profileId: string, since: Date, limit: number): Promise<NotificationRecord[]> {
    return Promise.resolve(
      this.notifications
        .forProfile(profileId)
        .filter((r) => !r.readAt && r.createdAt >= since)
        .slice(0, limit),
    );
  }

  markDigested(profileId: string, at: Date): Promise<void> {
    this.digested.set(profileId, at);
    return Promise.resolve();
  }
}
