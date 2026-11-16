import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import { PushEndpointInvalidError, PushSubscriptionLimitError } from '../domain/push.errors';
import { channelEnabled, type DigestFrequency } from '../domain/notification';
import {
  DeliveryGateway,
  DigestRepository,
  NotificationPeople,
  NotificationSubjects,
  PreferenceRepository,
  PushSender,
  PushSubscriptionRepository,
} from '../domain/notification.ports';
import { pushEndpointAllowed, pushKeysWellFormed, pushPayload } from '../domain/push';

/** POST /push-subscriptions et suivantes (NOT-15, NOT-16). */
@Injectable()
export class ManagePushSubscriptions {
  constructor(
    private readonly subscriptions: PushSubscriptionRepository,
    private readonly sender: PushSender,
    private readonly ids: IdGenerator,
  ) {}

  publicKey(): string | null {
    return this.sender.publicKey();
  }

  async register(input: {
    sessionId: string;
    profileId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    showDetails: boolean;
  }): Promise<void> {
    if (!pushEndpointAllowed(input.endpoint) || !pushKeysWellFormed(input)) {
      throw new PushEndpointInvalidError();
    }
    const result = await this.subscriptions.register({ id: this.ids.next(), ...input });
    if (result === 'limit') throw new PushSubscriptionLimitError();
  }

  async unregister(input: { sessionId: string; profileId: string; endpoint: string }) {
    await this.subscriptions.unregister(input);
  }

  async setDetails(input: {
    sessionId: string;
    profileId: string;
    endpoint: string;
    showDetails: boolean;
  }): Promise<void> {
    if (!(await this.subscriptions.setDetails(input))) throw new PushEndpointInvalidError();
  }
}

/**
 * NOT-06, NOT-07, NOT-11, NOT-14, NOT-15 (tâche planifiée) : réclame les push dues, revérifie que
 * la notification est visible et la push voulue, puis l'envoie à chaque appareil du profil dont la
 * session vit encore. Un appareil désabonné est oublié.
 */
@Injectable()
export class DeliverPushes {
  constructor(
    private readonly subscriptions: PushSubscriptionRepository,
    private readonly sender: PushSender,
    private readonly subjects: NotificationSubjects,
    private readonly preferences: PreferenceRepository,
    private readonly people: NotificationPeople,
    private readonly gateway: DeliveryGateway,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    if (!this.sender.enabled()) return 0;
    const due = await this.subscriptions.claimDue(this.clock.now(), 100);
    let sent = 0;
    for (const notification of due) {
      const overrides = await this.preferences.overrides(notification.profileId);
      if (!channelEnabled(overrides, notification.category, 'PUSH')) continue;
      const summary = await this.subjects.describe(notification.subject, notification.profileId);
      if (!summary) continue;
      // NOT-19, revérifié à l'envoi : les destinataires ont pu changer depuis la production.
      if (
        await this.subjects.sharesAccountWithRecipient(notification.subject, notification.profileId)
      ) {
        continue;
      }
      const names = await this.people.names([notification.profileId]);
      const profileName = names.get(notification.profileId) ?? '';
      for (const device of await this.subscriptions.devicesOf(notification.profileId)) {
        if (!(await this.gateway.sessionAlive(device.sessionId))) {
          await this.subscriptions.remove(device.subscriptionId);
          continue;
        }
        const payload = pushPayload({
          notification,
          profileName,
          showDetails: device.showDetails,
          detail: summary.title,
        });
        const outcome = await this.sender.send(device, payload);
        if (outcome === 'gone') await this.subscriptions.remove(device.subscriptionId);
        if (outcome === 'ok') sent += 1;
      }
    }
    return sent;
  }
}

const PERIOD_MS: Record<Exclude<DigestFrequency, 'OFF'>, number> = {
  DAILY: 24 * 3600_000,
  WEEKLY: 7 * 24 * 3600_000,
};

/**
 * NOT-08, NOT-17 (tâche planifiée, chaque heure) : un message par compte, regroupant les profils
 * dont le résumé est dû, avec le nombre de notifications non lues, encore visibles (NOT-11), nées
 * depuis leur dernier résumé dans les catégories où l'e-mail est activé. Rien de nouveau, rien
 * d'envoyé.
 */
@Injectable()
export class SendDigests {
  constructor(
    private readonly digests: DigestRepository,
    private readonly subjects: NotificationSubjects,
    private readonly preferences: PreferenceRepository,
    private readonly gateway: DeliveryGateway,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    const now = this.clock.now();
    const byAccount = new Map<
      string,
      { profileId: string; profileName: string; count: number }[]
    >();
    for (const candidate of await this.digests.candidates(
      new Date(now.getTime() - PERIOD_MS.WEEKLY),
    )) {
      if (candidate.digest === 'OFF') continue;
      const period = PERIOD_MS[candidate.digest];
      if (candidate.lastDigestAt && now.getTime() - candidate.lastDigestAt.getTime() < period) {
        continue;
      }
      const since = candidate.lastDigestAt ?? new Date(now.getTime() - period);
      // Revue SEC-40, M5 : réclamé en base d'après le dernier résumé lu ; une autre instance qui
      // l'a déjà pris l'emporte, et ce profil n'est pas compté deux fois.
      if (!(await this.digests.claimDigest(candidate.profileId, candidate.lastDigestAt, now))) {
        continue;
      }
      const overrides = await this.preferences.overrides(candidate.profileId);
      let count = 0;
      for (const row of await this.digests.unreadSince(candidate.profileId, since, 200)) {
        if (!channelEnabled(overrides, row.category, 'EMAIL')) continue;
        if (!(await this.subjects.describe(row.subject, candidate.profileId))) continue;
        // NOT-19 : la boîte du compte est partagée avec un destinataire de la liste.
        if (await this.subjects.sharesAccountWithRecipient(row.subject, candidate.profileId)) {
          continue;
        }
        count += 1;
      }
      if (count === 0) continue;
      const entries = byAccount.get(candidate.accountId) ?? [];
      entries.push({ profileId: candidate.profileId, profileName: candidate.profileName, count });
      byAccount.set(candidate.accountId, entries);
    }
    let sent = 0;
    for (const [accountId, entries] of byAccount) {
      const ok = await this.gateway.sendDigest(
        accountId,
        entries.map((e) => ({ profileName: e.profileName, count: e.count })),
      );
      if (ok) sent += 1;
    }
    return sent;
  }
}
