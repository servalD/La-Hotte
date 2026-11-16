import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { addDays, localDay } from '../../../shared/domain/event-date';
import type { EventRecord } from '../domain/event';
import { EventNotifier, EventRepository, type ReminderKind } from '../domain/event.ports';

/** Nombre de jours entre deux jours `AAAA-MM-JJ`. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** EVT-13 : invités sans réponse. */
function pending(event: EventRecord): string[] {
  return event.participants.filter((p) => p.rsvp === 'PENDING').map((p) => p.profileId);
}

/**
 * EVT-32 : les destinataires invités à cocher ce qu'ils ont reçu : tous ceux qui participent à un
 * échange, les honorés hors surprise (l'honoré d'une surprise n'a pas de ligne de participant et ne
 * voit pas l'événement, NOT-10 l'écarte de toute façon).
 */
function recipients(event: EventRecord): string[] {
  return event.participants
    .filter((p) =>
      event.mode === 'EXCHANGE' ? p.rsvp === 'YES' || p.rsvp === 'MAYBE' : p.isHonoree,
    )
    .map((p) => p.profileId);
}

/**
 * EVT-13, EVT-32 (tâche planifiée, chaque heure) : rappel à J-14 et J-3 aux invités sans réponse,
 * invitation du lendemain. Chaque rappel est réclamé en base avant d'être publié : plusieurs
 * instances n'envoient qu'une fois. Un rappel manqué (serveur arrêté) part au passage suivant tant
 * que son échéance suivante n'est pas atteinte.
 */
@Injectable()
export class SendEventReminders {
  constructor(
    private readonly events: EventRepository,
    private readonly notifier: EventNotifier,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    const now = this.clock.now();
    const today = localDay(now, 'UTC');
    // Candidats larges (fuseaux de -12 h à +14 h), revérifiés dans le fuseau de l'événement.
    const candidates = await this.events.reminderCandidates(addDays(today, -3), addDays(today, 15));
    let sent = 0;
    for (const { event, sent: done } of candidates) {
      const left = daysBetween(localDay(now, event.timezone), event.date);
      const due: { kind: ReminderKind; notice: 'reminder' | 'day_after'; to: string[] }[] = [];
      if (left <= 3 && left >= 0 && !done.reminder3) {
        due.push({ kind: 'reminder3', notice: 'reminder', to: pending(event) });
      } else if (left <= 14 && left > 3 && !done.reminder14) {
        due.push({ kind: 'reminder14', notice: 'reminder', to: pending(event) });
      }
      if (left <= -1 && left >= -3 && !done.dayAfter) {
        due.push({ kind: 'dayAfter', notice: 'day_after', to: recipients(event) });
      }
      for (const reminder of due) {
        if (!(await this.events.claimReminder(event.id, reminder.kind, now))) continue;
        // Un rappel à J-3 rend celui de J-14 sans objet.
        if (reminder.kind === 'reminder3')
          await this.events.claimReminder(event.id, 'reminder14', now);
        this.notifier.reminded(event.id, reminder.notice, reminder.to);
        sent += 1;
      }
    }
    return sent;
  }
}
