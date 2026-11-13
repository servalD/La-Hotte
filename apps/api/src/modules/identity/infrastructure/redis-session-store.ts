import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { RedisService } from '../../../platform/redis/redis.service';
import type {
  AccountAuthState,
  SessionCachePatch,
  SessionLookup,
  SessionRef,
} from '../domain/ports';
import { SessionStore } from '../domain/ports';
import {
  type AccountRole,
  type CachedSession,
  REVOCATION_MARK_MS,
  type SessionRecord,
  type Unlock,
} from '../domain/session';
import { IdentityUnavailableError } from '../domain/session.errors';

// Clés Redis (ADR 0013). Ni e-mail, ni nom, ni adresse IP : identifiants, horodatages, drapeaux.
const sessKey = (hash: string): string => `sess:${hash}`;
const revokedKey = (hash: string): string => `sess-revoked:${hash}`;
const epochKey = (accountId: string): string => `acct-epoch:${accountId}`;
const accountSessionsKey = (accountId: string): string => `acct-sess:${accountId}`;

/** Écrit le cache seulement sans marque de révocation (réhydratation atomique). */
const WRITE_IF_NOT_REVOKED = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX')
redis.call('SADD', KEYS[3], ARGV[3])
redis.call('PEXPIRE', KEYS[3], ARGV[4])
return 1`;

/** Modifie le cache s'il existe et n'est pas révoqué ; ne recrée jamais une clé disparue. */
const PATCH = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local session = cjson.decode(raw)
for key, value in pairs(cjson.decode(ARGV[1])) do session[key] = value end
if ARGV[2] == '' then
  redis.call('SET', KEYS[1], cjson.encode(session), 'KEEPTTL')
else
  redis.call('SET', KEYS[1], cjson.encode(session), 'PX', ARGV[2])
end
return 1`;

/**
 * Prolonge le déverrouillage seulement s'il est toujours celui qui a été lu (même profil, même
 * instant, même nonce) : un verrouillage ou un changement de profil survenu entre-temps l'emporte.
 * ARGV : profil, instant lu (ms), nonce lu ('' si aucun), nouvel instant (ms).
 */
const TOUCH_UNLOCK = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local session = cjson.decode(raw)
local unlock = session.unlock
if unlock == nil or unlock == cjson.null then return 0 end
local nonce = unlock.nonce
if nonce == nil or nonce == cjson.null then nonce = '' end
if unlock.profileId ~= ARGV[1] or tonumber(unlock.at) ~= tonumber(ARGV[2]) or nonce ~= ARGV[3] then
  return 0
end
unlock.at = tonumber(ARGV[4])
redis.call('SET', KEYS[1], cjson.encode(session), 'KEEPTTL')
return 1`;

/** Époque = max(Redis, valeur fournie), augmentée de 1 sur demande. Ne recule jamais. */
const EPOCH = `
local current = tonumber(redis.call('GET', KEYS[1]) or '-1')
local value = math.max(current, tonumber(ARGV[1]))
if ARGV[2] == '1' then value = value + 1 end
if value ~= current then redis.call('SET', KEYS[1], value) end
return value`;

/** Forme JSON du cache : dates en millisecondes. Le hash du jeton est la clé, pas une valeur. */
interface CacheJson {
  id: string;
  accountId: string;
  role: AccountRole;
  authEpoch: number;
  activeProfileId: string | null;
  reauthAt: number | null;
  trustedDeviceId: string | null;
  userAgent: string;
  lastSeenAt: number;
  expiresAt: number;
  absoluteExpiresAt: number;
  createdAt: number;
  persistedAt: number;
  unlock: { profileId: string; at: number; nonce: string | null } | null;
}

/**
 * Résultat d'un `MULTI` contrôlé commande par commande : une commande refusée dans la transaction
 * (`[[err, res]]`) ne passe pas en silence. Levée ici, elle devient `IdentityUnavailableError`.
 */
async function checked(
  pending: Promise<[error: Error | null, result: unknown][] | null>,
): Promise<void> {
  const results = await pending;
  if (results === null || results.some(([error]) => error !== null)) {
    throw new Error('Transaction Redis refusée');
  }
}

const ms = (date: Date): number => date.getTime();
const dateOrNull = (value: number | null): Date | null => (value === null ? null : new Date(value));

function toJson(record: SessionRecord, unlock: Unlock | null, persistedAt: Date): CacheJson {
  return {
    id: record.id,
    accountId: record.accountId,
    role: record.role,
    authEpoch: record.authEpoch,
    activeProfileId: record.activeProfileId,
    reauthAt: record.reauthAt ? ms(record.reauthAt) : null,
    trustedDeviceId: record.trustedDeviceId,
    userAgent: record.userAgent,
    lastSeenAt: ms(record.lastSeenAt),
    expiresAt: ms(record.expiresAt),
    absoluteExpiresAt: ms(record.absoluteExpiresAt),
    createdAt: ms(record.createdAt),
    persistedAt: ms(persistedAt),
    unlock: unlock ? { profileId: unlock.profileId, at: ms(unlock.at), nonce: unlock.nonce } : null,
  };
}

function fromJson(tokenHash: string, raw: string): CachedSession {
  const json = JSON.parse(raw) as CacheJson;
  return {
    record: {
      id: json.id,
      accountId: json.accountId,
      role: json.role,
      tokenHash,
      authEpoch: json.authEpoch,
      activeProfileId: json.activeProfileId,
      reauthAt: dateOrNull(json.reauthAt),
      trustedDeviceId: json.trustedDeviceId,
      userAgent: json.userAgent,
      lastSeenAt: new Date(json.lastSeenAt),
      expiresAt: new Date(json.expiresAt),
      absoluteExpiresAt: new Date(json.absoluteExpiresAt),
      createdAt: new Date(json.createdAt),
    },
    unlock: json.unlock
      ? { profileId: json.unlock.profileId, at: new Date(json.unlock.at), nonce: json.unlock.nonce }
      : null,
    persistedAt: new Date(json.persistedAt),
  };
}

function patchJson(patch: SessionCachePatch): Partial<CacheJson> {
  const out: Partial<CacheJson> = {};
  if (patch.lastSeenAt) out.lastSeenAt = ms(patch.lastSeenAt);
  if (patch.expiresAt) out.expiresAt = ms(patch.expiresAt);
  if (patch.persistedAt) out.persistedAt = ms(patch.persistedAt);
  if (patch.activeProfileId !== undefined) out.activeProfileId = patch.activeProfileId;
  if (patch.reauthAt !== undefined) out.reauthAt = patch.reauthAt ? ms(patch.reauthAt) : null;
  if (patch.unlock !== undefined) {
    out.unlock = patch.unlock
      ? { profileId: patch.unlock.profileId, at: ms(patch.unlock.at), nonce: patch.unlock.nonce }
      : null;
  }
  return out;
}

type SessionRow = {
  id: string;
  accountId: string;
  tokenHash: string;
  authEpoch: number;
  activeProfileId: string | null;
  reauthAt: Date | null;
  trustedDeviceId: string | null;
  userAgent: string;
  lastSeenAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  createdAt: Date;
  account: { role: AccountRole; status: 'ACTIVE' | 'SUSPENDED'; authEpoch: number };
};

const SESSION_WITH_ACCOUNT = {
  account: { select: { role: true, status: true, authEpoch: true } },
} as const;

function rowToRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    role: row.account.role,
    tokenHash: row.tokenHash,
    authEpoch: row.authEpoch,
    activeProfileId: row.activeProfileId,
    reauthAt: row.reauthAt,
    trustedDeviceId: row.trustedDeviceId,
    userAgent: row.userAgent,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    absoluteExpiresAt: row.absoluteExpiresAt,
    createdAt: row.createdAt,
  };
}

/**
 * Adaptateur du port `SessionStore` (ADR 0013) : PostgreSQL source de vérité, Redis cache.
 * Toute erreur Redis devient `IdentityUnavailableError` (503, échec fermé) ; aucune n'est
 * avalée.
 */
@Injectable()
export class RedisSessionStore extends SessionStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {
    super();
  }

  async insert(record: SessionRecord, now: Date): Promise<void> {
    await this.prisma.session.create({
      data: {
        id: record.id,
        accountId: record.accountId,
        tokenHash: record.tokenHash,
        authEpoch: record.authEpoch,
        activeProfileId: record.activeProfileId,
        reauthAt: record.reauthAt,
        trustedDeviceId: record.trustedDeviceId,
        userAgent: record.userAgent,
        lastSeenAt: record.lastSeenAt,
        expiresAt: record.expiresAt,
        absoluteExpiresAt: record.absoluteExpiresAt,
        createdAt: record.createdAt,
      },
    });
    await this.writeCache(record, null, now);
  }

  async lookup(tokenHash: string): Promise<SessionLookup> {
    const [raw, revoked] = await this.redis((r) =>
      r.mget(sessKey(tokenHash), revokedKey(tokenHash)),
    );
    if (revoked !== null) return { kind: 'revoked' };
    if (raw !== null && raw !== undefined) {
      const session = fromJson(tokenHash, raw);
      const cachedEpoch = await this.redis((r) => r.get(epochKey(session.record.accountId)));
      const accountEpoch =
        cachedEpoch !== null
          ? Number(cachedEpoch)
          : ((await this.accountState(session.record.accountId))?.epoch ?? -1);
      return { kind: 'cached', session, accountEpoch };
    }

    const row = (await this.prisma.session.findUnique({
      where: { tokenHash },
      include: SESSION_WITH_ACCOUNT,
    })) as SessionRow | null;
    if (!row) return { kind: 'absent' };
    const epoch = await this.syncEpoch(row.accountId, row.account.authEpoch, false);
    return {
      kind: 'stored',
      record: rowToRecord(row),
      account: {
        accountId: row.accountId,
        role: row.account.role,
        active: row.account.status === 'ACTIVE',
        epoch,
      },
    };
  }

  async rehydrate(record: SessionRecord, now: Date): Promise<boolean> {
    return this.writeCache(record, null, now);
  }

  async patchCache(tokenHash: string, patch: SessionCachePatch, ttlMs?: number): Promise<boolean> {
    const done = await this.redis((r) =>
      r.eval(
        PATCH,
        2,
        sessKey(tokenHash),
        revokedKey(tokenHash),
        JSON.stringify(patchJson(patch)),
        ttlMs === undefined ? '' : String(Math.max(1, Math.floor(ttlMs))),
      ),
    );
    return done === 1;
  }

  async touchUnlock(tokenHash: string, expected: Unlock, at: Date): Promise<boolean> {
    const done = await this.redis((r) =>
      r.eval(
        TOUCH_UNLOCK,
        2,
        sessKey(tokenHash),
        revokedKey(tokenHash),
        expected.profileId,
        String(ms(expected.at)),
        expected.nonce ?? '',
        String(ms(at)),
      ),
    );
    return done === 1;
  }

  async persistActivity(
    ref: SessionRef,
    authEpoch: number,
    lastSeenAt: Date,
    expiresAt: Date,
  ): Promise<boolean> {
    // Confronte le cache à la base : ligne présente, même hash, compte actif, même époque. Un
    // instantané ancien de Redis ne ressuscite donc une session que 5 minutes au plus.
    const { count } = await this.prisma.session.updateMany({
      where: {
        id: ref.id,
        tokenHash: ref.tokenHash,
        authEpoch,
        account: { is: { authEpoch, status: 'ACTIVE' } },
      },
      data: { lastSeenAt, expiresAt },
    });
    return count === 1;
  }

  async revoke(ref: SessionRef): Promise<void> {
    // 1. Marque du jeton connu, avant toute lecture en base : PostgreSQL en panne, la session est
    //    tout de même refusée (la lecture la voit dans le même MGET).
    await this.mark([ref.tokenHash]);
    const hashes = new Set([ref.tokenHash]);
    // Révocation par `id` : une rotation concurrente ne la contourne pas en changeant le hash.
    // Toujours limitée au compte de la référence (défense contre une IDOR).
    const current = await this.prisma.session.findFirst({
      where: { id: ref.id, accountId: ref.accountId },
      select: { tokenHash: true },
    });
    if (current && !hashes.has(current.tokenHash)) {
      await this.mark([current.tokenHash]);
      hashes.add(current.tokenHash);
    }
    // 2. Ligne.
    const deleted = await this.prisma.$queryRaw<{ token_hash: string }[]>`
      DELETE FROM "session"
      WHERE "id" = ${ref.id}::uuid AND "account_id" = ${ref.accountId}::uuid
      RETURNING "token_hash"`;
    const late = deleted.map((row) => row.token_hash).filter((hash) => !hashes.has(hash));
    if (late.length > 0) {
      await this.mark(late);
      late.forEach((hash) => hashes.add(hash));
    }
    // 3. Cache.
    await this.dropCache(ref.accountId, [...hashes]);
  }

  async revokeToken(ref: SessionRef): Promise<boolean> {
    await this.mark([ref.tokenHash]);
    const { count } = await this.prisma.session.deleteMany({
      where: { id: ref.id, accountId: ref.accountId, tokenHash: ref.tokenHash },
    });
    await this.dropCache(ref.accountId, [ref.tokenHash]);
    return count === 1;
  }

  private async dropCache(accountId: string, hashes: string[]): Promise<void> {
    await this.redis((r) => {
      const batch = r.multi();
      for (const hash of hashes) batch.del(sessKey(hash)).srem(accountSessionsKey(accountId), hash);
      return checked(batch.exec());
    });
  }

  private async mark(hashes: string[]): Promise<void> {
    await this.redis((r) => {
      const batch = r.multi();
      for (const hash of hashes) batch.set(revokedKey(hash), '1', 'PX', REVOCATION_MARK_MS);
      return checked(batch.exec());
    });
  }

  async findOwned(accountId: string, sessionId: string): Promise<SessionRef | null> {
    const row = await this.prisma.session.findFirst({
      where: { id: sessionId, accountId },
      select: { id: true, accountId: true, tokenHash: true },
    });
    return row ? { id: row.id, accountId: row.accountId, tokenHash: row.tokenHash } : null;
  }

  async listForAccount(accountId: string): Promise<SessionRecord[]> {
    const rows = (await this.prisma.session.findMany({
      where: { accountId },
      include: SESSION_WITH_ACCOUNT,
      orderBy: { lastSeenAt: 'desc' },
    })) as SessionRow[];
    return rows.map(rowToRecord);
  }

  async revokeAllForAccount(accountId: string, exceptSessionId?: string): Promise<SessionRef[]> {
    const rows = await this.prisma.session.findMany({
      where: { accountId },
      select: { id: true, tokenHash: true },
    });
    const kept = rows.find((row) => row.id === exceptSessionId)?.tokenHash;
    const revoked: SessionRef[] = [];
    for (const row of rows) {
      if (row.id === exceptSessionId) continue;
      const ref = { id: row.id, accountId, tokenHash: row.tokenHash };
      await this.revoke(ref);
      revoked.push(ref);
    }
    // Nettoyage seulement : un cache sans ligne reçoit aussi sa marque.
    const cached = await this.redis((r) => r.smembers(accountSessionsKey(accountId)));
    const handled = new Set(rows.map((row) => row.tokenHash));
    for (const hash of cached) {
      if (handled.has(hash) || hash === kept) continue;
      await this.redis((r) =>
        checked(
          r
            .multi()
            .set(revokedKey(hash), '1', 'PX', REVOCATION_MARK_MS)
            .del(sessKey(hash))
            .srem(accountSessionsKey(accountId), hash)
            .exec(),
        ),
      );
    }
    return revoked;
  }

  async rotateToken(ref: SessionRef, newTokenHash: string, reauthAt: Date): Promise<boolean> {
    // L'ancien jeton est révoqué avant que le nouveau n'existe : en cas d'arrêt, échec fermé.
    await this.redis((r) => r.set(revokedKey(ref.tokenHash), '1', 'PX', REVOCATION_MARK_MS));
    const { count } = await this.prisma.session.updateMany({
      where: { id: ref.id, tokenHash: ref.tokenHash },
      data: { tokenHash: newTokenHash, reauthAt },
    });
    await this.redis((r) =>
      checked(
        r
          .multi()
          .del(sessKey(ref.tokenHash))
          .srem(accountSessionsKey(ref.accountId), ref.tokenHash)
          .exec(),
      ),
    );
    if (count === 0) return false;

    const row = (await this.prisma.session.findUnique({
      where: { id: ref.id },
      include: SESSION_WITH_ACCOUNT,
    })) as SessionRow | null;
    if (!row || row.tokenHash !== newTokenHash) return false;
    // Le déverrouillage n'est pas recopié : un verrouillage concurrent ne peut pas être annulé, et
    // le profil se redéverrouille par son PIN.
    return this.writeCache(rowToRecord(row), null, reauthAt);
  }

  async setActiveProfile(ref: SessionRef, profileId: string | null): Promise<void> {
    // Échec fermé : le déverrouillage disparaît avant tout autre changement.
    await this.patchCache(ref.tokenHash, { unlock: null });
    await this.prisma.session.updateMany({
      where: { id: ref.id, tokenHash: ref.tokenHash },
      data: { activeProfileId: profileId, reauthAt: null },
    });
    await this.patchCache(ref.tokenHash, {
      activeProfileId: profileId,
      reauthAt: null,
      unlock: null,
    });
  }

  async lock(ref: SessionRef): Promise<void> {
    await this.patchCache(ref.tokenHash, { unlock: null, reauthAt: null });
    await this.prisma.session.updateMany({
      where: { id: ref.id, tokenHash: ref.tokenHash },
      data: { reauthAt: null },
    });
  }

  async findById(
    sessionId: string,
  ): Promise<{ record: SessionRecord; unlock: Unlock | null; accountEpoch: number } | null> {
    const row = (await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: SESSION_WITH_ACCOUNT,
    })) as SessionRow | null;
    if (!row || row.account.status !== 'ACTIVE') return null;
    const [raw, revoked] = await this.redis((r) =>
      r.mget(sessKey(row.tokenHash), revokedKey(row.tokenHash)),
    );
    if (revoked !== null) return null;
    const accountEpoch = await this.syncEpoch(row.accountId, row.account.authEpoch, false);
    const unlock = raw ? fromJson(row.tokenHash, raw).unlock : null;
    return { record: rowToRecord(row), unlock, accountEpoch };
  }

  async accountState(accountId: string): Promise<AccountAuthState | null> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { role: true, status: true, authEpoch: true },
    });
    if (!account) return null;
    const epoch = await this.syncEpoch(accountId, account.authEpoch, false);
    return { accountId, role: account.role, active: account.status === 'ACTIVE', epoch };
  }

  async beginEpochChange(accountId: string): Promise<number> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { authEpoch: true },
    });
    if (!account) throw new Error('Compte introuvable');
    // ADR 0014 : E+1 dans Redis tout de suite, E+2 à écrire en base dans la transaction.
    return (await this.syncEpoch(accountId, account.authEpoch, true)) + 1;
  }

  async completeEpochChange(accountId: string, epoch: number): Promise<void> {
    await this.redis((r) => r.eval(EPOCH, 1, epochKey(accountId), String(epoch), '0'));
  }

  /**
   * Époque courante = max(Redis, PostgreSQL). Si une transaction a échoué après l'augmentation
   * dans Redis (ADR 0013 « Ordre », ADR 0014), la base est rattrapée vers l'avant : les nouvelles sessions
   * restent possibles, les anciennes restent refusées.
   */
  private async syncEpoch(accountId: string, dbEpoch: number, raise: boolean): Promise<number> {
    const value = Number(
      await this.redis((r) =>
        r.eval(EPOCH, 1, epochKey(accountId), String(dbEpoch), raise ? '1' : '0'),
      ),
    );
    if (!raise && value > dbEpoch) {
      await this.prisma.account.updateMany({
        where: { id: accountId, authEpoch: { lt: value } },
        data: { authEpoch: value },
      });
    }
    return value;
  }

  private async writeCache(
    record: SessionRecord,
    unlock: Unlock | null,
    now: Date,
  ): Promise<boolean> {
    const ttl = Math.floor(record.expiresAt.getTime() - now.getTime());
    if (ttl <= 0) return false;
    const done = await this.redis((r) =>
      r.eval(
        WRITE_IF_NOT_REVOKED,
        3,
        sessKey(record.tokenHash),
        revokedKey(record.tokenHash),
        accountSessionsKey(record.accountId),
        JSON.stringify(toJson(record, unlock, now)),
        String(ttl),
        record.tokenHash,
        String(REVOCATION_MARK_MS),
      ),
    );
    return done === 1;
  }

  /** Toute erreur Redis : refus en échec fermé (503). Le message d'origine n'est pas repris. */
  private async redis<T>(run: (client: Redis) => Promise<T>): Promise<T> {
    try {
      return await run(await this.redisService.ready());
    } catch {
      throw new IdentityUnavailableError();
    }
  }
}
