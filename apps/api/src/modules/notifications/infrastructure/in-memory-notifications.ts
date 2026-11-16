import {
  type ChannelPreference,
  DEFAULT_SETTINGS,
  type NotificationRecord,
  type NotificationSettings,
} from '../domain/notification';
import {
  type NewNotification,
  NotificationPeople,
  NotificationRepository,
  PreferenceRepository,
} from '../domain/notification.ports';

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
