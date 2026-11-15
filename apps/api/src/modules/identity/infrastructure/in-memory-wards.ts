/* eslint-disable @typescript-eslint/require-await -- doubles synchrones derrière des ports asynchrones */
import type { NewProfile } from '../domain/account';
import { MAX_PROFILES_PER_ACCOUNT } from '../domain/profile';
import type { Guardianship, OpenWardSetup, WardSummary } from '../domain/ward';
import { WardRepository } from '../domain/ward.ports';
import type { InMemoryAccountRepository, MemoryGuardianRules } from './in-memory';
import type { InMemoryLinkRepository } from './in-memory-links';

interface MemorySetup {
  id: string;
  guardianAccountId: string;
  email: string;
  profileName: string;
  tokenHash: string;
  attestedAt: Date;
  tokenExpiresAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
}

/**
 * Comptes sous tutelle en mémoire (tests de contrat). Partage les magasins des comptes, des profils
 * et des liens ; sert aussi de règles de tutelle au double des profils (`MemoryGuardianRules`).
 */
export class InMemoryWardRepository extends WardRepository implements MemoryGuardianRules {
  readonly setups = new Map<string, MemorySetup>();
  readonly releaseRequested = new Set<string>();

  constructor(
    private readonly accounts: InMemoryAccountRepository,
    private readonly links: InMemoryLinkRepository,
  ) {
    super();
  }

  private profilesOf(accountId: string) {
    return [...this.accounts.profiles.values()]
      .filter((p) => p.accountId === accountId)
      .sort((x, y) => (x.createdAt?.getTime() ?? 0) - (y.createdAt?.getTime() ?? 0));
  }

  isWard(accountId: string): boolean {
    return Boolean(this.accounts.rows.get(accountId)?.guardianAccountId);
  }

  gap(accountId: string): boolean {
    const own = this.profilesOf(accountId);
    if (!this.isWard(accountId) && own.length > 0 && own.every((p) => p.isChild ?? false)) {
      return true;
    }
    for (const ward of this.accounts.rows.values()) {
      if (ward.guardianAccountId !== accountId) continue;
      for (const child of this.profilesOf(ward.id)) {
        const guarded = this.links.linksOf(child.id).some((l) => {
          const other = this.accounts.profiles.get(l.otherId);
          return (
            l.origin === 'GUARDIANSHIP' &&
            other?.accountId === accountId &&
            !(other.isChild ?? false)
          );
        });
        if (!guarded) return true;
      }
    }
    return false;
  }

  async guardianshipOf(accountId: string): Promise<Guardianship | null> {
    const guardianId = this.accounts.rows.get(accountId)?.guardianAccountId;
    const guardian = guardianId ? this.accounts.rows.get(guardianId) : null;
    return guardian ? { guardianAccountId: guardian.id, guardianEmail: guardian.email } : null;
  }

  async hasWards(accountId: string): Promise<boolean> {
    return [...this.accounts.rows.values()].some((row) => row.guardianAccountId === accountId);
  }

  async createSetupRequest(input: {
    readonly id: string;
    readonly guardianAccountId: string;
    readonly email: string;
    readonly profileName: string;
    readonly tokenHash: string;
    readonly now: Date;
    readonly tokenExpiresAt: Date;
    readonly expiresAt: Date;
  }): Promise<void> {
    this.setups.set(input.tokenHash, {
      id: input.id,
      guardianAccountId: input.guardianAccountId,
      email: input.email,
      profileName: input.profileName,
      tokenHash: input.tokenHash,
      attestedAt: input.now,
      tokenExpiresAt: input.tokenExpiresAt,
      expiresAt: input.expiresAt,
      completedAt: null,
    });
  }

  private open(tokenHash: string, now: Date): MemorySetup | null {
    const setup = this.setups.get(tokenHash);
    if (!setup || setup.completedAt) return null;
    if (setup.tokenExpiresAt <= now || setup.expiresAt <= now) return null;
    return setup;
  }

  async findOpenSetup(tokenHash: string, now: Date): Promise<OpenWardSetup | null> {
    const setup = this.open(tokenHash, now);
    return setup
      ? {
          transferId: setup.id,
          guardianAccountId: setup.guardianAccountId,
          email: setup.email,
          profileName: setup.profileName,
          guardianAttestedAt: setup.attestedAt,
        }
      : null;
  }

  private linkToGuardian(
    wardProfileId: string,
    guardianAccountId: string,
    linkIds: () => string,
    now: Date,
  ): number {
    const guardians = this.profilesOf(guardianAccountId);
    for (const guardian of guardians) {
      this.links.addAcceptedLink({
        id: linkIds(),
        profileIds: [guardian.id, wardProfileId],
        origin: (guardian.isChild ?? false) ? 'TRANSFER' : 'GUARDIANSHIP',
        requestedBy: guardian.id,
        now,
      });
    }
    return guardians.filter((g) => !(g.isChild ?? false)).length;
  }

  async completeSetup(input: {
    readonly tokenHash: string;
    readonly accountId: string;
    readonly passwordHash: string;
    readonly profile: NewProfile;
    readonly linkIds: () => string;
    readonly now: Date;
  }): Promise<
    | { readonly status: 'created'; readonly guardianAccountId: string }
    | { readonly status: 'invalid' | 'email_taken' }
  > {
    const setup = this.open(input.tokenHash, input.now);
    if (!setup) return { status: 'invalid' };
    if (
      (await this.accounts.findByEmail(setup.email)) ||
      (await this.accounts.isEmailReserved(setup.email, null, input.now))
    ) {
      return { status: 'email_taken' };
    }
    if (!this.profilesOf(setup.guardianAccountId).some((p) => !(p.isChild ?? false))) {
      return { status: 'invalid' };
    }
    this.accounts.seed({
      id: input.accountId,
      email: setup.email,
      passwordHash: input.passwordHash,
      emailVerifiedAt: input.now,
      createdAt: input.now,
      guardianAccountId: setup.guardianAccountId,
    });
    this.accounts.profiles.set(input.profile.id, {
      ...input.profile,
      accountId: input.accountId,
      isChild: true,
      createdAt: input.now,
    });
    this.linkToGuardian(input.profile.id, setup.guardianAccountId, input.linkIds, input.now);
    setup.completedAt = input.now;
    return { status: 'created', guardianAccountId: setup.guardianAccountId };
  }

  private summary(accountId: string): WardSummary | null {
    const row = this.accounts.rows.get(accountId);
    if (!row?.guardianAccountId) return null;
    return {
      id: row.id,
      email: row.email,
      createdAt: row.createdAt,
      releaseRequested: this.releaseRequested.has(row.id),
      profiles: this.profilesOf(row.id).map((p) => ({
        id: p.id,
        displayName: p.displayName,
        avatar: p.avatar ?? null,
        accentColor: p.accentColor,
        hasPin: Boolean(p.pinHash),
        isChild: p.isChild ?? false,
        hasEmail: Boolean(p.emailVerifiedAt),
      })),
    };
  }

  async listWards(guardianAccountId: string): Promise<WardSummary[]> {
    return [...this.accounts.rows.values()]
      .filter((row) => row.guardianAccountId === guardianAccountId)
      .flatMap((row) => this.summary(row.id) ?? []);
  }

  async findWard(guardianAccountId: string, wardAccountId: string): Promise<WardSummary | null> {
    const row = this.accounts.rows.get(wardAccountId);
    return row?.guardianAccountId === guardianAccountId ? this.summary(wardAccountId) : null;
  }

  async createWardProfile(input: {
    readonly wardAccountId: string;
    readonly profile: NewProfile;
    readonly linkIds: () => string;
    readonly now: Date;
  }): Promise<'created' | 'limit' | 'missing'> {
    const guardianAccountId = this.accounts.rows.get(input.wardAccountId)?.guardianAccountId;
    if (!guardianAccountId) return 'missing';
    if (this.profilesOf(input.wardAccountId).length >= MAX_PROFILES_PER_ACCOUNT) return 'limit';
    this.accounts.profiles.set(input.profile.id, {
      ...input.profile,
      accountId: input.wardAccountId,
      isChild: true,
      createdAt: input.now,
    });
    this.linkToGuardian(input.profile.id, guardianAccountId, input.linkIds, input.now);
    this.releaseRequested.delete(input.wardAccountId);
    return 'created';
  }

  async requestRelease(
    guardianAccountId: string,
    wardAccountId: string,
  ): Promise<'requested' | 'missing' | 'multiple_profiles'> {
    if (this.accounts.rows.get(wardAccountId)?.guardianAccountId !== guardianAccountId) {
      return 'missing';
    }
    if (this.profilesOf(wardAccountId).length !== 1) return 'multiple_profiles';
    this.releaseRequested.add(wardAccountId);
    return 'requested';
  }

  async attestAgeAndRelease(
    wardAccountId: string,
    now: Date,
  ): Promise<
    | {
        readonly status: 'released';
        readonly guardianAccountId: string;
        readonly profileId: string;
      }
    | { readonly status: 'not_requested' | 'multiple_profiles' }
  > {
    const row = this.accounts.rows.get(wardAccountId);
    if (!row?.guardianAccountId || !this.releaseRequested.has(wardAccountId)) {
      return { status: 'not_requested' };
    }
    const profiles = this.profilesOf(wardAccountId);
    const [profile] = profiles;
    if (profiles.length !== 1 || !profile) return { status: 'multiple_profiles' };
    const guardianAccountId = row.guardianAccountId;
    row.guardianAccountId = null;
    this.releaseRequested.delete(wardAccountId);
    this.accounts.profiles.set(profile.id, {
      ...profile,
      isChild: false,
      childChangedAt: now,
      childNoticeAt: now,
    });
    for (const link of this.links.linksOf(profile.id)) {
      if (link.origin === 'GUARDIANSHIP') this.links.setOrigin(link.id, 'TRANSFER');
    }
    for (const token of this.accounts.tokens.values()) {
      if (
        token.accountId === wardAccountId &&
        token.purpose === 'PASSWORD_RESET' &&
        !token.usedAt
      ) {
        token.usedAt = now;
      }
    }
    return { status: 'released', guardianAccountId, profileId: profile.id };
  }
}
