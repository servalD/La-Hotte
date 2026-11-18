import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AuditJournal,
  Clock,
  IdGenerator,
  type PlatformSettingKey,
  PlatformSettings,
  type PlatformSettingValues,
} from '../../../shared/domain';
import { AccountSearchRateLimitedError } from '../domain/admin.errors';
import {
  AccountDirectory,
  type AccountMetadata,
  AccountSearchQuota,
  type AdminActionOnAccount,
} from '../domain/account-directory';
import { validateSetting } from '../domain/settings';

/** Empreinte d'une adresse pour le journal (ADM-10) : jamais l'adresse elle-même. */
function fingerprint(email: string): string {
  return createHash('sha256').update(email, 'utf8').digest('hex');
}

/**
 * ADM-10 : recherche par adresse exacte, plafonnée, journalisée **avant** la lecture : si
 * l'entrée ne s'écrit pas, rien n'est lu (AUD-05).
 */
@Injectable()
export class SearchAccount {
  constructor(
    private readonly directory: AccountDirectory,
    private readonly quota: AccountSearchQuota,
    private readonly journal: AuditJournal,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly actorAccountId: string;
    readonly ip: string;
    readonly email: string;
  }): Promise<AccountMetadata | null> {
    const now = this.clock.now();
    if (!(await this.quota.take(input.actorAccountId, now))) {
      throw new AccountSearchRateLimitedError();
    }
    const email = input.email.normalize('NFC').trim().toLowerCase();
    await this.journal.append({
      id: this.ids.next(),
      at: now,
      entry: {
        actorAccountId: input.actorAccountId,
        action: 'account.search',
        targetKind: null,
        targetId: null,
        reason: null,
        ip: input.ip,
        after: fingerprint(email),
      },
    });
    return this.directory.findByEmail(email);
  }
}

/** ADM-09 : lecture des réglages de plateforme. */
@Injectable()
export class ReadSettings {
  constructor(private readonly settings: PlatformSettings) {}

  execute(): PlatformSettingValues {
    return this.settings.current();
  }
}

/** ADM-09, RBAC-06 : un réglage changé, avec son ancienne et sa nouvelle valeur au journal. */
@Injectable()
export class UpdateSetting {
  constructor(
    private readonly settings: PlatformSettings,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly actorAccountId: string;
    readonly ip: string;
    readonly key: PlatformSettingKey;
    readonly value: unknown;
    readonly reason: string;
  }): Promise<PlatformSettingValues> {
    const value = validateSetting(input.key, input.value);
    await this.settings.write({
      key: input.key,
      value,
      updatedBy: input.actorAccountId,
      audit: (before) => ({
        id: this.ids.next(),
        at: this.clock.now(),
        entry: {
          actorAccountId: input.actorAccountId,
          action: 'setting.update',
          targetKind: 'SETTING',
          targetId: null,
          reason: input.reason,
          ip: input.ip,
          before: { key: input.key, value: before },
          after: { key: input.key, value },
        },
      }),
    });
    return this.settings.current();
  }
}

/** AUD-03, AUD-07 : actions d'administration faites sur le compte de la session. */
@Injectable()
export class ListAdminActionsOnAccount {
  constructor(private readonly directory: AccountDirectory) {}

  execute(accountId: string): Promise<AdminActionOnAccount[]> {
    return this.directory.actionsOn(accountId);
  }
}
