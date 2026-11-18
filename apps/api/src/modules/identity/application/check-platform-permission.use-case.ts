import { Injectable } from '@nestjs/common';
import { SessionStore } from '../domain/ports';
import { hasPlatformPermission, type PlatformPermission } from '../domain/platform-permissions';
import type { AccountRole } from '../domain/session';

/** Compte autorisé dans l'espace d'administration (RBAC-05). */
export interface PlatformActor {
  readonly accountId: string;
  readonly role: AccountRole;
}

/**
 * RBAC-04, RBAC-05 : le rôle est relu en base à chaque requête `/admin`, jamais pris dans le cache
 * de session ; un retrait de rôle prend effet à la requête suivante. `null` : refus (la présentation
 * répond comme à une route inconnue).
 */
@Injectable()
export class CheckPlatformPermission {
  constructor(private readonly store: SessionStore) {}

  async execute(accountId: string, permission: PlatformPermission): Promise<PlatformActor | null> {
    const account = await this.store.accountState(accountId);
    if (!account?.active) return null;
    if (!hasPlatformPermission(account.role, permission)) return null;
    return { accountId, role: account.role };
  }
}
