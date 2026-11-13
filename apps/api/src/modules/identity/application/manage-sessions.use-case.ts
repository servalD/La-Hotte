import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import { SessionNotFoundError } from '../domain/account.errors';
import type { SessionRef } from '../domain/ports';
import { SessionLifecycle } from './session-lifecycle';

/** Session listée dans l'espace Compte (AUTH-05) : métadonnées seulement (PIN-08). */
export interface SessionSummary {
  readonly id: string;
  readonly userAgent: string;
  readonly createdAt: Date;
  /** Recopiée en base au plus toutes les 5 minutes (ADR 0013). */
  readonly lastSeenAt: Date;
  readonly current: boolean;
}

/**
 * AUTH-05 : liste des sessions du compte, depuis PostgreSQL, sans les sessions expirées pas encore
 * nettoyées (`expires_at` en base peut avoir 5 minutes de retard : une session tout juste expirée
 * peut encore apparaître ; elle est de toute façon refusée).
 */
@Injectable()
export class ListSessions {
  constructor(
    private readonly lifecycle: SessionLifecycle,
    private readonly clock: Clock,
  ) {}

  async execute(current: SessionRef): Promise<SessionSummary[]> {
    const now = this.clock.now().getTime();
    const records = await this.lifecycle.list(current.accountId);
    return records
      .filter(
        (record) =>
          record.id === current.id ||
          (record.expiresAt.getTime() > now && record.absoluteExpiresAt.getTime() > now),
      )
      .map((record) => ({
        id: record.id,
        userAgent: record.userAgent,
        createdAt: record.createdAt,
        lastSeenAt: record.lastSeenAt,
        current: record.id === current.id,
      }))
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
  }
}

/**
 * AUTH-05 : révocation d'une session du compte. L'identifiant vient du client : le hash est lu par
 * `id` et `account_id` (`revokeOwned`), une session d'un autre compte reste intacte et répond
 * `404` comme une session inconnue (SEC-04). Renvoie vrai si c'était la session courante.
 */
@Injectable()
export class RevokeSession {
  constructor(private readonly lifecycle: SessionLifecycle) {}

  async execute(current: SessionRef, sessionId: string): Promise<{ current: boolean }> {
    const revoked = await this.lifecycle.revokeOwned(current.accountId, sessionId);
    if (!revoked) throw new SessionNotFoundError();
    return { current: revoked.id === current.id };
  }
}

/** Déconnexion : la session courante est révoquée (ADR 0013, « Révocation »). */
@Injectable()
export class SignOut {
  constructor(private readonly lifecycle: SessionLifecycle) {}

  async execute(current: SessionRef): Promise<void> {
    await this.lifecycle.revoke(current);
  }
}
