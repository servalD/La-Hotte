import { Clock, IdGenerator } from '../../../shared/domain';
import type { IdentityEvent } from '../domain/ports';
import { InProcessIdentityEvents } from '../infrastructure/adapters';
import { CryptoSecretTokens } from '../infrastructure/crypto-tokens';
import { InMemoryProfileLockPolicies, InMemorySessionStore } from '../infrastructure/in-memory';
import { CheckSessionAccess } from './check-session-access.use-case';
import { ResolveSession } from './resolve-session.use-case';
import { SessionLifecycle } from './session-lifecycle';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

class TestClock extends Clock {
  current = new Date('2026-11-13T12:00:00Z');
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

class SequentialIds extends IdGenerator {
  private n = 0;
  next(): string {
    this.n += 1;
    return `0190f3c2-0000-7000-8000-${String(this.n).padStart(12, '0')}`;
  }
}

function setup() {
  const clock = new TestClock();
  const store = new InMemorySessionStore();
  const tokens = new CryptoSecretTokens();
  const events = new InProcessIdentityEvents();
  const published: IdentityEvent[] = [];
  events.subscribe((event) => published.push(event));
  const policies = new InMemoryProfileLockPolicies();
  const lifecycle = new SessionLifecycle(store, tokens, events, new SequentialIds(), clock);
  const resolve = new ResolveSession(store, tokens, lifecycle, clock);
  const check = new CheckSessionAccess(store, policies, clock);
  store.addAccount('acct');
  policies.set({ profileId: 'prof', accountId: 'acct', hasPin: true, relock: 'IDLE_15' });
  /** Connexion : époque lue avant les identifiants (ADR 0014). */
  const open = async (
    extra: { previous?: { id: string; accountId: string; tokenHash: string } } = {},
  ) =>
    lifecycle.create({
      accountId: 'acct',
      observedEpoch: (await lifecycle.observeEpoch('acct')) ?? -1,
      userAgent: 'ua',
      ...extra,
    });
  return { clock, store, tokens, lifecycle, resolve, check, published, policies, open };
}

describe('ResolveSession (ADR 0013, « Stockage »)', () => {
  it('jeton absent, mal formé ou inconnu : aucune session', async () => {
    const { resolve } = setup();
    expect(await resolve.execute(null)).toBeNull();
    expect(await resolve.execute('court')).toBeNull();
    expect(await resolve.execute('a'.repeat(43))).toBeNull();
  });

  it('session valide : expiration glissante, base recopiée au plus toutes les 5 minutes', async () => {
    const { resolve, clock, store, open } = setup();
    const { token, record } = await open();

    clock.advance(MINUTE);
    const first = await resolve.execute(token);
    expect(first?.record.expiresAt).toEqual(new Date(clock.current.getTime() + 30 * DAY));
    expect(store.rows.get(record.id)?.lastSeenAt).toEqual(record.lastSeenAt);

    clock.advance(5 * MINUTE);
    await resolve.execute(token);
    expect(store.rows.get(record.id)?.lastSeenAt).toEqual(clock.current);
  });

  it('AUTH-05 : durée absolue dépassée malgré l’activité : refus et révocation', async () => {
    const { resolve, clock, store, published, open } = setup();
    const { token, record } = await open();
    for (let day = 0; day < 89; day += 20) {
      clock.advance(20 * DAY);
      if (clock.current < record.absoluteExpiresAt)
        expect(await resolve.execute(token)).not.toBeNull();
    }
    clock.current = new Date(record.absoluteExpiresAt);
    expect(await resolve.execute(token)).toBeNull();
    expect(store.rows.has(record.id)).toBe(false);
    expect(store.revokedMarks.has(record.tokenHash)).toBe(true);
    expect(published.at(-1)).toEqual({
      type: 'session.revoked',
      sessionId: record.id,
      accountId: 'acct',
    });
  });

  it('ADR 0013 : époque du compte augmentée : refus, depuis le cache comme depuis la base', async () => {
    const { resolve, store, open } = setup();
    const a = await open();
    const b = await open();
    await store.beginEpochChange('acct');
    expect(await resolve.execute(a.token)).toBeNull();
    store.dropCache();
    expect(await resolve.execute(b.token)).toBeNull();
  });

  it('critère de 01 : marque de révocation posée, ligne encore en base (panne) : refus', async () => {
    const { resolve, store, open } = setup();
    const { token, record } = await open();
    store.revokedMarks.add(record.tokenHash);
    expect(await resolve.execute(token)).toBeNull();
    store.dropCache();
    expect(await resolve.execute(token)).toBeNull();
  });

  it('ADR 0013 : session réhydratée depuis la base : profil actif gardé, déverrouillage perdu', async () => {
    const { resolve, lifecycle, store, clock, open } = setup();
    const { token, record } = await open();
    const ref = { id: record.id, accountId: 'acct', tokenHash: record.tokenHash };
    await lifecycle.selectProfile(ref, 'prof');
    await store.patchCache(record.tokenHash, {
      unlock: { profileId: 'prof', at: clock.now(), nonce: null },
    });
    expect((await resolve.execute(token))?.unlock).not.toBeNull();

    store.dropCache();
    const rehydrated = await resolve.execute(token);
    expect(rehydrated?.record.activeProfileId).toBe('prof');
    expect(rehydrated?.unlock).toBeNull();
  });

  it('compte suspendu : refus à la réhydratation', async () => {
    const { resolve, store, open } = setup();
    const { token } = await open();
    const account = store.accounts.get('acct');
    if (account) account.active = false;
    store.dropCache();
    expect(await resolve.execute(token)).toBeNull();
  });
});

describe('SessionLifecycle (ADR 0013, « Rotation »)', () => {
  it('connexion depuis un navigateur déjà connecté : l’ancienne session est révoquée côté serveur', async () => {
    const { resolve, open } = setup();
    const old = await open();
    const next = await open({
      previous: { id: old.record.id, accountId: 'acct', tokenHash: old.record.tokenHash },
    });
    expect(next.record.id).not.toBe(old.record.id);
    expect(await resolve.execute(old.token)).toBeNull();
    expect(await resolve.execute(next.token)).not.toBeNull();
  });

  it('ré-authentification : même id, nouveau jeton, ancien refusé, profil reverrouillé', async () => {
    const { resolve, lifecycle, store, clock, open } = setup();
    const issued = await open();
    const ref = { id: issued.record.id, accountId: 'acct', tokenHash: issued.record.tokenHash };
    await lifecycle.selectProfile(ref, 'prof');
    await store.patchCache(ref.tokenHash, {
      unlock: { profileId: 'prof', at: clock.now(), nonce: null },
    });

    const rotated = await lifecycle.rotate(ref);
    expect(rotated.record.id).toBe(issued.record.id);
    expect(rotated.token).not.toBe(issued.token);
    expect(rotated.record.reauthAt).toEqual(clock.now());
    expect(await resolve.execute(issued.token)).toBeNull();
    // Le déverrouillage n'est pas recopié : un verrouillage concurrent ne peut pas être annulé.
    const after = await resolve.execute(rotated.token);
    expect(after?.record.activeProfileId).toBe('prof');
    expect(after?.unlock).toBeNull();
    // Une rotation d'un jeton déjà remplacé échoue.
    await expect(lifecycle.rotate(ref)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('AUTH-05 : révoquer les autres sessions part des lignes, garde la session courante', async () => {
    const { resolve, lifecycle, open } = setup();
    const keep = await open();
    const other = await open();
    await lifecycle.revokeAll('acct', keep.record.id);
    expect(await resolve.execute(other.token)).toBeNull();
    expect(await resolve.execute(keep.token)).not.toBeNull();
  });

  it('PIN-07 : changer de profil efface déverrouillage et ré-authentification, et publie', async () => {
    const { lifecycle, store, clock, published, open } = setup();
    const issued = await open();
    const ref = { id: issued.record.id, accountId: 'acct', tokenHash: issued.record.tokenHash };
    const rotated = await lifecycle.rotate(ref);
    const current = { ...ref, tokenHash: rotated.record.tokenHash };
    await store.patchCache(current.tokenHash, {
      unlock: { profileId: 'prof', at: clock.now(), nonce: null },
    });

    await lifecycle.selectProfile(current, 'prof');
    const cached = store.cache.get(current.tokenHash);
    expect(cached?.unlock).toBeNull();
    expect(cached?.record.reauthAt).toBeNull();
    expect(published.at(-1)).toEqual({
      type: 'session.profile_changed',
      sessionId: ref.id,
      profileId: 'prof',
    });

    await lifecycle.lock(current, 'prof');
    expect(published.at(-1)).toEqual({
      type: 'profile.locked',
      sessionId: ref.id,
      profileId: 'prof',
    });
  });

  it('compte inactif ou inconnu : aucune session créée', async () => {
    const { lifecycle } = setup();
    await expect(
      lifecycle.create({ accountId: 'inconnu', observedEpoch: 0, userAgent: 'ua' }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('Époque du compte (ADR 0014)', () => {
  it('connexion vérifiée contre l’ancien secret : époque observée avant le changement, refusée', async () => {
    const { lifecycle, store, resolve, open } = setup();
    const before = await open();
    // La connexion lit l'époque, puis vérifie le mot de passe (ancien hash encore en base)…
    const observed = (await lifecycle.observeEpoch('acct')) ?? -1;
    // … pendant que le changement de mot de passe commence.
    const committed = await store.beginEpochChange('acct');
    await expect(
      lifecycle.create({ accountId: 'acct', observedEpoch: observed, userAgent: 'ua' }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(await resolve.execute(before.token)).toBeNull();

    // Connexion qui observe l'époque intermédiaire (E+1) : refusée après la validation (E+2).
    const during = await open();
    store.commitEpoch('acct', committed);
    await store.completeEpochChange('acct', committed);
    expect(await resolve.execute(during.token)).toBeNull();
    expect(await resolve.execute((await open()).token)).not.toBeNull();
  });

  it('transaction jamais validée : l’époque intermédiaire devient la courante, reconnexion possible', async () => {
    const { store, resolve, open } = setup();
    await store.beginEpochChange('acct');
    expect(await resolve.execute((await open()).token)).not.toBeNull();
  });
});

describe('Déverrouillage concurrent (PIN-07, revue SEC-40)', () => {
  it('un rafraîchissement en vol n’annule jamais un verrouillage', async () => {
    const { store, lifecycle, clock, open } = setup();
    const issued = await open();
    const ref = { id: issued.record.id, accountId: 'acct', tokenHash: issued.record.tokenHash };
    await lifecycle.selectProfile(ref, 'prof');
    const unlock = { profileId: 'prof', at: clock.now(), nonce: null };
    await store.patchCache(ref.tokenHash, { unlock });

    // Requête lue déverrouillée, puis verrouillage, puis la requête veut prolonger.
    await lifecycle.lock(ref, 'prof');
    clock.advance(MINUTE);
    expect(await store.touchUnlock(ref.tokenHash, unlock, clock.now())).toBe(false);
    expect(store.cache.get(ref.tokenHash)?.unlock).toBeNull();
  });
});

describe('Cache confronté à la base (revue SEC-40, I2)', () => {
  it('ligne disparue (cache restauré d’un ancien instantané) : refus au plus tard 5 minutes après', async () => {
    const { store, resolve, clock, open } = setup();
    const issued = await open();
    store.rows.delete(issued.record.id);
    clock.advance(5 * MINUTE);
    expect(await resolve.execute(issued.token)).toBeNull();
    expect(store.revokedMarks.has(issued.record.tokenHash)).toBe(true);
  });
});

describe('CheckSessionAccess (ADR 0013, passerelle temps réel)', () => {
  it('vrai seulement pour le profil actif, déverrouillé, d’une session vivante', async () => {
    const { lifecycle, store, clock, check, open } = setup();
    const issued = await open();
    const ref = { id: issued.record.id, accountId: 'acct', tokenHash: issued.record.tokenHash };
    await lifecycle.selectProfile(ref, 'prof');
    expect(await check.execute(ref.id, 'prof')).toBe(false);

    await store.patchCache(ref.tokenHash, {
      unlock: { profileId: 'prof', at: clock.now(), nonce: null },
    });
    expect(await check.execute(ref.id, 'prof')).toBe(true);
    expect(await check.execute(ref.id, 'autre')).toBe(false);

    // Expiration passive du déverrouillage : aucun événement, revérifiée à chaque émission.
    clock.advance(15 * MINUTE);
    expect(await check.execute(ref.id, 'prof')).toBe(false);

    await lifecycle.revoke(ref);
    expect(await check.execute(ref.id, 'prof')).toBe(false);
  });
});
