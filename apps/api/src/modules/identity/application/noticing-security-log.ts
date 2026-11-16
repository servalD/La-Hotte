import { Injectable } from '@nestjs/common';
import {
  IdentityEvents,
  type SecurityEvent,
  SecurityLog,
  SecurityLogStore,
  type SecurityNotice,
} from '../domain/ports';

/** NOT-02, NOT-12 : événements du journal qui donnent un avis de sécurité, et à qui. */
const NOTICES: Partial<
  Record<SecurityEvent, { notice: SecurityNotice; scope: 'profile' | 'account' }>
> = {
  'pin.reset': { notice: 'pin_reset', scope: 'profile' },
  'login.succeeded': { notice: 'login', scope: 'account' },
  'totp.enabled': { notice: 'totp_enabled', scope: 'account' },
  'totp.disabled': { notice: 'totp_disabled', scope: 'account' },
};

/**
 * Journal de sécurité qui publie, après l'écriture, l'avis de sécurité correspondant (ADR 0018).
 * Les avis ne portent que des identifiants (OBS-20).
 */
@Injectable()
export class NoticingSecurityLog extends SecurityLog {
  constructor(
    private readonly store: SecurityLogStore,
    private readonly events: IdentityEvents,
  ) {
    super();
  }

  async record(entry: Parameters<SecurityLog['record']>[0]): Promise<void> {
    await this.store.record(entry);
    const notice = NOTICES[entry.event];
    if (!notice || !entry.accountId) return;
    if (notice.scope === 'profile' && !entry.profileId) return;
    this.events.publish({
      type: 'security.notice',
      notice: notice.notice,
      accountId: entry.accountId,
      profileId: notice.scope === 'profile' ? (entry.profileId ?? null) : null,
    });
  }
}
