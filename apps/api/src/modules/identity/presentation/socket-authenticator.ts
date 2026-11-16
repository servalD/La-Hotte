import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfig } from '../../../platform/config/env';
import { CheckSessionAccess } from '../application/check-session-access.use-case';
import { ResolveSession } from '../application/resolve-session.use-case';
import { readCookie, SESSION_COOKIE } from './cookies';

/** Identité d'une socket : sa session et le profil actif au moment de la poignée de main. */
export interface SocketIdentity {
  readonly sessionId: string;
  readonly accountId: string;
  readonly profileId: string;
}

/**
 * API-30, RT-01 : poignée de main de la passerelle temps réel. Même origine que l'application,
 * cookie de session valable, profil actif déverrouillé (ADR 0013, `checkSessionAccess`) ; sinon
 * `null`, sans dire pourquoi. Les écritures ne passent jamais par la socket (API-34) : pas de CSRF.
 */
@Injectable()
export class SocketAuthenticator {
  private readonly webOrigin: string;

  constructor(
    private readonly resolveSession: ResolveSession,
    private readonly checkAccess: CheckSessionAccess,
    config: AppConfig,
  ) {
    this.webOrigin = config.env.WEB_ORIGIN;
  }

  async authenticate(headers: {
    readonly cookie?: string | undefined;
    readonly origin?: string | undefined;
  }): Promise<SocketIdentity | null> {
    if (headers.origin !== this.webOrigin) return null;
    const request = { headers: { cookie: headers.cookie } } as unknown as Request;
    const session = await this.resolveSession.execute(readCookie(request, SESSION_COOKIE));
    const profileId = session?.record.activeProfileId ?? null;
    if (!session || !profileId) return null;
    if (!(await this.checkAccess.execute(session.record.id, profileId))) return null;
    return { sessionId: session.record.id, accountId: session.record.accountId, profileId };
  }
}
