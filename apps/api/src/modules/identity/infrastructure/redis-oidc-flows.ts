import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { RedisService } from '../../../platform/redis/redis.service';
import type { GoogleReauthProof, OidcFlow, OidcFlowKind } from '../domain/google';
import { GoogleReauthProofs, OidcFlows } from '../domain/google.ports';
import { IdentityUnavailableError } from '../domain/session.errors';

const flowKey = (stateHash: string): string => `oidc:${stateHash}`;
const proofKey = (sessionId: string): string => `oidc-reauth:${sessionId}`;

interface StoredFlow {
  k: OidcFlowKind;
  b: string;
  a: string | null;
  e: number | null;
  n: string;
  v: string;
  r: { d: string; l: string | null; t: string | null; i?: string | null } | null;
  c: number;
}

interface StoredProof {
  h: string;
  e: number;
  c: number;
}

const FLOW_KINDS: readonly OidcFlowKind[] = ['login', 'link', 'reauth'];

/** Relecture défensive : une valeur d'une autre forme est traitée comme absente. */
function parseFlow(raw: string | null): OidcFlow | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as StoredFlow;
    if (!FLOW_KINDS.includes(v.k) || typeof v.b !== 'string' || typeof v.n !== 'string') {
      return null;
    }
    if (typeof v.v !== 'string' || typeof v.c !== 'number') return null;
    return {
      kind: v.k,
      binding: v.b,
      accountId: v.a,
      epoch: v.e,
      nonce: v.n,
      codeVerifier: v.v,
      registration: v.r
        ? {
            displayName: v.r.d,
            locale: v.r.l,
            timezone: v.r.t,
            invitationTokenHash: typeof v.r.i === 'string' ? v.r.i : null,
          }
        : null,
      createdAt: new Date(v.c),
    };
  } catch {
    return null;
  }
}

function parseProof(raw: string | null): GoogleReauthProof | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as StoredProof;
    if (typeof v.h !== 'string' || typeof v.e !== 'number' || typeof v.c !== 'number') return null;
    return { tokenHash: v.h, epoch: v.e, createdAt: new Date(v.c) };
  } catch {
    return null;
  }
}

async function withRedis<T>(service: RedisService, run: (client: Redis) => Promise<T>): Promise<T> {
  try {
    return await run(await service.ready());
  } catch {
    throw new IdentityUnavailableError();
  }
}

/**
 * Parcours Google en cours (ADR 0013) : **Redis seul**, clé dérivée du hash de `state` (la valeur
 * en clair ne vit que dans l'URL de Google et son retour). `GETDEL` : un `state` ne sert qu'une
 * fois, même en concurrence. Panne : refus en échec fermé (503).
 */
@Injectable()
export class RedisOidcFlows extends OidcFlows {
  constructor(private readonly redisService: RedisService) {
    super();
  }

  async create(stateHash: string, flow: OidcFlow, ttlMs: number): Promise<void> {
    const value: StoredFlow = {
      k: flow.kind,
      b: flow.binding,
      a: flow.accountId,
      e: flow.epoch,
      n: flow.nonce,
      v: flow.codeVerifier,
      r: flow.registration
        ? {
            d: flow.registration.displayName,
            l: flow.registration.locale,
            t: flow.registration.timezone,
            i: flow.registration.invitationTokenHash,
          }
        : null,
      c: flow.createdAt.getTime(),
    };
    await withRedis(this.redisService, (r) =>
      r.set(flowKey(stateHash), JSON.stringify(value), 'PX', ttlMs),
    );
  }

  async consume(stateHash: string): Promise<OidcFlow | null> {
    return parseFlow(await withRedis(this.redisService, (r) => r.getdel(flowKey(stateHash))));
  }
}

/** AUTH-14 : retour de Google en attente du code TOTP, par session, Redis seul. */
@Injectable()
export class RedisGoogleReauthProofs extends GoogleReauthProofs {
  constructor(private readonly redisService: RedisService) {
    super();
  }

  async create(sessionId: string, proof: GoogleReauthProof, ttlMs: number): Promise<void> {
    const value: StoredProof = { h: proof.tokenHash, e: proof.epoch, c: proof.createdAt.getTime() };
    await withRedis(this.redisService, (r) =>
      r.set(proofKey(sessionId), JSON.stringify(value), 'PX', ttlMs),
    );
  }

  async find(sessionId: string): Promise<GoogleReauthProof | null> {
    return parseProof(await withRedis(this.redisService, (r) => r.get(proofKey(sessionId))));
  }

  async consume(sessionId: string): Promise<GoogleReauthProof | null> {
    return parseProof(await withRedis(this.redisService, (r) => r.getdel(proofKey(sessionId))));
  }
}
