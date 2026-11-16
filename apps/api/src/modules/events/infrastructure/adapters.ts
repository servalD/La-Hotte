import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { EventInvitationNotices } from '../../identity';
import { EventWishlists } from '../../lists';
import {
  EventInvitationMail,
  EventNotifier,
  EventTokens,
  EventWishlistCreator,
  ResponseFloor,
} from '../domain/event.ports';

/** 16 octets en base64url, sans remplissage : 22 caractères. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** EVT-16 : 128 bits tirés par `node:crypto`, stockés en SHA-256 (comme LNK-01). */
@Injectable()
export class CryptoEventTokens extends EventTokens {
  generate(): string {
    return randomBytes(16).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  isWellFormed(token: string): boolean {
    return TOKEN_PATTERN.test(token);
  }
}

/** EVT-16 : temps plancher d'un refus de lien. */
export const LINK_REFUSAL_FLOOR_MS = 500;

@Injectable()
export class SleepingResponseFloor extends ResponseFloor {
  constructor(private readonly clock: Clock) {
    super();
  }

  async pad(startedAt: Date): Promise<void> {
    const left = LINK_REFUSAL_FLOOR_MS - (this.clock.now().getTime() - startedAt.getTime());
    if (left > 0) await sleep(left);
  }
}

/** EVT-15 : l'e-mail neutre part d'`identity`, seul détenteur des adresses des comptes. */
@Injectable()
export class IdentityEventInvitationMail extends EventInvitationMail {
  constructor(private readonly notices: EventInvitationNotices) {
    super();
  }

  notifyInvited(profileIds: readonly string[]): void {
    this.notices.notify(profileIds);
  }
}

/** EVT-36 : la wishlist naît dans `lists`, qui revérifie EVT-29. */
@Injectable()
export class ListsEventWishlistCreator extends EventWishlistCreator {
  constructor(private readonly wishlists: EventWishlists) {
    super();
  }

  ensure(input: { profileId: string; eventId: string }): Promise<string | null> {
    return this.wishlists.ensure(input);
  }
}

/** EVT-41 : port vide jusqu'à la phase 4. */
@Injectable()
export class NoEventNotifier extends EventNotifier {
  eventCancelled(): void {}
  participantWithdrew(): void {}
}
