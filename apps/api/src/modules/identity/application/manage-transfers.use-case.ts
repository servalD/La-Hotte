import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../../shared/domain';
import { normalizeEmail } from '../domain/account';
import { AccountRepository, BackgroundTasks, PasswordHasher } from '../domain/account.ports';
import {
  IdentityEvents,
  RateLimiter,
  SecretTokens,
  type SecurityEvent,
  SecurityLog,
} from '../domain/ports';
import { isPinWellFormed } from '../domain/profile';
import { LastProfileError, ProfileNotFoundError } from '../domain/profile.errors';
import { ProfileRepository } from '../domain/profile.ports';
import { RateLimitedError } from '../domain/session.errors';
import {
  type ConsentChannel,
  consentRefusal,
  defaultPinChoice,
  departureRefusal,
  isPinChoiceValid,
  profileConsentRequired,
  TRANSFER_MAIL_TOKEN_TTL_MS,
  TRANSFER_TTL_MS,
  ACCOUNT_SETUP_TTL_MS,
  type TransferPinChoice,
} from '../domain/transfer';
import {
  DetachChildForbiddenError,
  DetachEmailRequiredError,
  HasWardsError,
  TransferConsentUnsafeError,
  TransferInvalidError,
  TransferPendingError,
  TransferPinChoiceError,
  UndeclaredRegroupError,
} from '../domain/transfer.errors';
import {
  type CompletedTransfer,
  type IncomingTransfer,
  type TransferPreview,
  TransferRepository,
  type TransferState,
} from '../domain/transfer.ports';
import { GuardianRequiredError, WardChildOnlyError } from '../domain/ward.errors';
import { WardRepository } from '../domain/ward.ports';
import { AccountMailer } from './account-mailer';
import type { ActiveProfile } from './authorize-profile.use-case';
import type { ClientInfo } from './client-info';
import { SessionLifecycle } from './session-lifecycle';
import { failToken } from './token-failure';

/** Client des tâches planifiées (exécution différée, PRO-12) : aucune requête d'origine. */
export const SCHEDULER_CLIENT: ClientInfo = { ip: '0.0.0.0', userAgent: 'task:profile.transfer' };

/**
 * Effets d'un changement de compte, après la transaction (PRO-14) : sessions désélectionnées dans
 * le cache, `circle.changed`, journal des deux comptes, avis, et suppression du compte d'origine
 * vidé par un regroupement.
 */
@Injectable()
export class TransferEffects {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly transfers: TransferRepository,
    private readonly lifecycle: SessionLifecycle,
    private readonly events: IdentityEvents,
    private readonly securityLog: SecurityLog,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly clock: Clock,
  ) {}

  async apply(result: CompletedTransfer, transferId: string, client: ClientInfo): Promise<void> {
    await this.lifecycle.deselect(result.deselected);
    this.events.publish({ type: 'circle.changed', profileIds: result.circleChanged });
    const now = this.clock.now();
    for (const accountId of [result.fromAccountId, result.toAccountId]) {
      await this.securityLog.record({
        accountId,
        profileId: result.profileId,
        transferId,
        event: 'profile.transfer_completed',
        ip: client.ip,
        userAgent: client.userAgent,
        at: now,
      });
    }
    const [from, to] = await Promise.all([
      this.accounts.findById(result.fromAccountId),
      this.accounts.findById(result.toAccountId),
    ]);
    this.background.run('transfer.completed_mail', async () => {
      for (const address of new Set(
        [from?.email, to?.email, result.profileEmail].filter((a): a is string => Boolean(a)),
      )) {
        await this.mailer.send(address, { kind: 'transfer_completed' });
      }
    });
    if (result.fromEmptied) {
      // PRO-12 : regroupement ; le compte d'origine disparaît avec ses sessions (ADR 0014).
      const outcome = { suspended: false };
      await this.lifecycle.changeEpoch(result.fromAccountId, async (epoch) => {
        outcome.suspended = await this.transfers.suspendEmptyAccount(result.fromAccountId, epoch);
      });
      if (outcome.suspended) await this.transfers.deleteEmptyAccount(result.fromAccountId);
    }
  }
}

async function log(
  securityLog: SecurityLog,
  accountId: string,
  event: SecurityEvent,
  client: ClientInfo,
  at: Date,
  ids: { readonly profileId: string; readonly transferId: string },
): Promise<void> {
  await securityLog.record({
    accountId,
    profileId: ids.profileId,
    transferId: ids.transferId,
    event,
    ip: client.ip,
    userAgent: client.userAgent,
    at,
  });
}

/** Lien d'accord ou d'annulation envoyé à l'adresse vérifiée du profil (PRO-12). */
async function mailProfile(
  deps: {
    readonly transfers: TransferRepository;
    readonly tokens: SecretTokens;
    readonly mailer: AccountMailer;
    readonly background: BackgroundTasks;
    readonly ids: IdGenerator;
  },
  transfer: TransferState,
  purpose: 'TRANSFER_CONSENT' | 'TRANSFER_CANCEL',
  now: Date,
): Promise<void> {
  const subject = await deps.transfers.subject(transfer.profileId);
  if (!subject?.email) return;
  const token = deps.tokens.generate();
  await deps.transfers.issueMailToken({
    id: deps.ids.next(),
    accountId: subject.accountId,
    profileId: transfer.profileId,
    transferId: transfer.id,
    purpose,
    tokenHash: deps.tokens.hash(token),
    now,
    expiresAt: new Date(now.getTime() + TRANSFER_MAIL_TOKEN_TTL_MS),
  });
  const to = subject.email;
  const executesAt = transfer.executesAt;
  deps.background.run('transfer.profile_mail', async () => {
    await deps.mailer.send(
      to,
      purpose === 'TRANSFER_CONSENT' || !executesAt
        ? { kind: 'transfer_consent', token }
        : { kind: 'transfer_cancel', token, executesAt },
    );
  });
}

/** PRO-12 : choix de PIN cohérent, et hash du nouveau PIN s'il y en a un. */
async function resolvePin(
  hasher: PasswordHasher,
  choice: TransferPinChoice,
  hasPin: boolean,
  newPin: string | undefined,
): Promise<string | null> {
  if (newPin !== undefined && !isPinWellFormed(newPin)) throw new TransferPinChoiceError();
  if (!isPinChoiceValid(choice, hasPin, newPin !== undefined)) throw new TransferPinChoiceError();
  return newPin !== undefined ? hasher.hash(newPin) : null;
}

export interface RequestedTransfer {
  readonly transferId: string;
  /** PRO-12 : jeton de passage, rendu une seule fois, à transmettre au compte d'arrivée. */
  readonly token: string | null;
  readonly expiresAt: Date;
}

/**
 * PRO-12, PRO-13 : demande de passage ou de détachement depuis l'espace Compte d'origine, après
 * ré-authentification (route). C'est l'accord du compte d'origine. Un compte sous tutelle ne la
 * fait pas (son tuteur). Le détachement vers une adresse déjà inscrite reçoit la même réponse.
 */
@Injectable()
export class RequestTransfer {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly profiles: ProfileRepository,
    private readonly transfers: TransferRepository,
    private readonly wards: WardRepository,
    private readonly tokens: SecretTokens,
    private readonly hasher: PasswordHasher,
    private readonly limiter: RateLimiter,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly securityLog: SecurityLog,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly accountId: string;
    readonly profileId: string;
    readonly kind: 'MOVE' | 'DETACH';
    readonly regroup: boolean;
    readonly email?: string;
    readonly pinChoice?: TransferPinChoice;
    readonly newPin?: string;
    readonly client: ClientInfo;
  }): Promise<RequestedTransfer> {
    if (await this.wards.guardianshipOf(input.accountId)) throw new WardChildOnlyError();
    const subject = await this.transfers.subject(input.profileId);
    if (!subject || subject.accountId !== input.accountId) throw new ProfileNotFoundError();
    if (input.kind === 'DETACH' && subject.isChild) throw new DetachChildForbiddenError();

    const others = (await this.profiles.listMetadata(input.accountId)).filter(
      (p) => p.id !== input.profileId,
    );
    const refusal = departureRefusal(
      input.kind,
      { isWard: false, remaining: others },
      input.regroup,
    );
    if (refusal === 'UNDECLARED_REGROUP') throw new UndeclaredRegroupError();
    if (refusal === 'LAST_PROFILE') throw new LastProfileError();
    if (refusal === 'GUARDIAN_REQUIRED') throw new GuardianRequiredError();
    if (input.regroup && input.kind !== 'MOVE') throw new UndeclaredRegroupError();
    if (input.regroup && (await this.wards.hasWards(input.accountId))) throw new HasWardsError();

    const now = this.clock.now();
    const consentRequired = profileConsentRequired(subject, now);
    const pinChoice = input.pinChoice ?? defaultPinChoice(subject.hasPin);
    // Avec l'accord du profil, c'est lui qui choisit et saisit son PIN ; sans, la demande le porte.
    const newPinHash = consentRequired
      ? null
      : await resolvePin(this.hasher, pinChoice, subject.hasPin, input.newPin);

    const subjects = [{ scope: 'transfer_request' as const, parts: [input.accountId] }];
    const check = await this.limiter.check(subjects, now);
    if (!check.allowed || !check.reservation) throw new RateLimitedError(check.retryAfterMs);

    const token = this.tokens.generateInvitation();
    const transferId = this.ids.next();
    const expiresAt = new Date(now.getTime() + TRANSFER_TTL_MS);
    // PRO-13 : l'adresse du profil par défaut, ou une autre saisie à la demande.
    const newEmail =
      input.kind === 'DETACH' ? (input.email ? normalizeEmail(input.email) : subject.email) : null;
    if (input.kind === 'DETACH' && !newEmail) throw new DetachEmailRequiredError();
    const created = await this.transfers.create({
      id: transferId,
      kind: input.kind,
      profileId: input.profileId,
      fromAccountId: input.accountId,
      newEmail,
      tokenHash: this.tokens.hash(token),
      // PRO-13 : le lien d'installation ne part qu'après le délai ; ce jeton-là ne sert pas.
      tokenExpiresAt: input.kind === 'MOVE' ? expiresAt : now,
      expiresAt,
      profileConsentRequired: consentRequired,
      regroup: input.regroup,
      pinChoice,
      newPinHash,
      now,
    });
    if (created === 'pending') throw new TransferPendingError();
    if (created === 'missing') throw new ProfileNotFoundError();
    await this.limiter.recordFailure(subjects, now, check.reservation);
    await log(this.securityLog, input.accountId, 'profile.transfer_requested', input.client, now, {
      profileId: input.profileId,
      transferId,
    });
    if (newEmail) {
      // PRO-13 : adresse déjà inscrite, titulaire averti ; la réponse reste la même.
      const to = newEmail;
      this.background.run('transfer.detach_taken_check', async () => {
        const existing = await this.accounts.findByEmail(to);
        if (existing?.emailVerified || (await this.accounts.isEmailReserved(to, null, now))) {
          await this.mailer.send(to, { kind: 'email_taken_notice' });
        }
      });
    }
    const state = await this.transfers.findOpenByProfile(input.profileId, now);
    if (state && consentRequired) {
      const deps = {
        transfers: this.transfers,
        tokens: this.tokens,
        mailer: this.mailer,
        background: this.background,
        ids: this.ids,
      };
      await mailProfile(deps, state, 'TRANSFER_CONSENT', now);
    }
    return { transferId, token: input.kind === 'MOVE' ? token : null, expiresAt };
  }
}

/** PRO-12 : demande ouverte d'un profil, vue par son compte d'origine. */
@Injectable()
export class GetAccountProfileTransfer {
  constructor(
    private readonly transfers: TransferRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly accountId: string;
    readonly profileId: string;
  }): Promise<TransferState> {
    const transfer = await this.transfers.findOpenByProfile(input.profileId, this.clock.now());
    if (!transfer || transfer.fromAccountId !== input.accountId) throw new TransferInvalidError();
    return transfer;
  }
}

/** PRO-12 : annulation par le compte d'origine, tant que le passage n'est pas exécuté. */
@Injectable()
export class CancelTransferAsOrigin {
  constructor(
    private readonly transfers: TransferRepository,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly accountId: string;
    readonly profileId: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    const now = this.clock.now();
    const transfer = await this.transfers.findOpenByProfile(input.profileId, now);
    if (!transfer || transfer.fromAccountId !== input.accountId) throw new TransferInvalidError();
    if (!(await this.transfers.cancel(transfer.id, now))) throw new TransferInvalidError();
    await log(this.securityLog, input.accountId, 'profile.transfer_cancelled', input.client, now, {
      profileId: transfer.profileId,
      transferId: transfer.id,
    });
  }
}

export interface OwnTransferView {
  readonly transfer: TransferState;
  /** PRO-12 : profils du compte d'arrivée que le profil connaît (passage accepté). */
  readonly destinationNames: readonly string[];
}

/** PRO-12 : la demande qui concerne le profil actif, montrée à chaque entrée. */
@Injectable()
export class GetOwnTransfer {
  constructor(
    private readonly transfers: TransferRepository,
    private readonly clock: Clock,
  ) {}

  async execute(active: ActiveProfile): Promise<OwnTransferView | null> {
    const transfer = await this.transfers.findOpenByProfile(active.id, this.clock.now());
    if (!transfer || transfer.fromAccountId !== active.accountId) return null;
    const destinationNames =
      transfer.kind === 'MOVE' && transfer.toAccountId
        ? await this.transfers.linkedNamesIn(active.id, transfer.toAccountId)
        : [];
    return { transfer, destinationNames };
  }
}

/** Dépendances communes aux accords du profil. */
@Injectable()
export class ProfileConsent {
  constructor(
    readonly transfers: TransferRepository,
    readonly tokens: SecretTokens,
    readonly hasher: PasswordHasher,
    readonly limiter: RateLimiter,
    readonly mailer: AccountMailer,
    readonly background: BackgroundTasks,
    readonly securityLog: SecurityLog,
    readonly ids: IdGenerator,
    readonly clock: Clock,
  ) {}

  /**
   * PRO-12 (B4, B4 bis) : accord refusé après une réinitialisation récente du PIN ou par une
   * adresse récente ; pour un détachement vers une autre adresse que la sienne, seulement depuis
   * le profil (I3). Le choix de PIN du profil l'emporte sur celui de la demande.
   */
  async give(input: {
    readonly transfer: TransferState;
    readonly channel: ConsentChannel;
    readonly pinChoice: TransferPinChoice;
    readonly newPin?: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    const subject = await this.transfers.subject(input.transfer.profileId);
    if (!subject || !input.transfer.profileConsentRequired) throw new TransferInvalidError();
    const now = this.clock.now();
    if (consentRefusal(subject, input.channel, now)) throw new TransferConsentUnsafeError();
    if (
      input.transfer.kind === 'DETACH' &&
      input.channel === 'EMAIL' &&
      input.transfer.newEmail !== subject.email
    ) {
      throw new TransferConsentUnsafeError();
    }
    const newPinHash = await resolvePin(this.hasher, input.pinChoice, subject.hasPin, input.newPin);
    const consented = await this.transfers.consentProfile({
      transferId: input.transfer.id,
      pinChoice: input.pinChoice,
      newPinHash,
      now,
    });
    if (!consented) throw new TransferInvalidError();
    await log(
      this.securityLog,
      subject.accountId,
      'profile.transfer_consented',
      input.client,
      now,
      {
        profileId: input.transfer.profileId,
        transferId: input.transfer.id,
      },
    );
    const after = await this.transfers.findOpenByProfile(input.transfer.profileId, now);
    if (after?.executesAt) await mailProfile(this, after, 'TRANSFER_CANCEL', now);
  }
}

/** PRO-12 : accord du profil actif, PIN validé (garde). */
@Injectable()
export class ConsentOwnTransfer {
  constructor(private readonly consent: ProfileConsent) {}

  async execute(input: {
    readonly active: ActiveProfile;
    readonly pinChoice: TransferPinChoice;
    readonly newPin?: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    const transfer = await this.consent.transfers.findOpenByProfile(
      input.active.id,
      this.consent.clock.now(),
    );
    if (!transfer || transfer.fromAccountId !== input.active.accountId) {
      throw new TransferInvalidError();
    }
    await this.consent.give({
      transfer,
      channel: 'PROFILE',
      pinChoice: input.pinChoice,
      ...(input.newPin !== undefined ? { newPin: input.newPin } : {}),
      client: input.client,
    });
  }
}

/** PRO-12 : le profil actif refuse (ou annule) la demande qui le concerne. */
@Injectable()
export class RefuseOwnTransfer {
  constructor(
    private readonly transfers: TransferRepository,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly active: ActiveProfile;
    readonly client: ClientInfo;
  }): Promise<void> {
    const now = this.clock.now();
    const transfer = await this.transfers.findOpenByProfile(input.active.id, now);
    if (!transfer || transfer.fromAccountId !== input.active.accountId) {
      throw new TransferInvalidError();
    }
    if (!(await this.transfers.cancel(transfer.id, now))) throw new TransferInvalidError();
    await log(
      this.securityLog,
      input.active.accountId,
      'profile.transfer_cancelled',
      input.client,
      now,
      {
        profileId: transfer.profileId,
        transferId: transfer.id,
      },
    );
  }
}

/** PRO-12 : accord du profil par le lien envoyé à son adresse vérifiée (route publique). */
@Injectable()
export class ConsentTransferByEmail {
  constructor(private readonly consent: ProfileConsent) {}

  async execute(input: {
    readonly token: string;
    readonly pinChoice: TransferPinChoice;
    readonly newPin?: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    const { transfers, tokens, clock, limiter } = this.consent;
    const tokenHash = tokens.isWellFormed(input.token) ? tokens.hash(input.token) : null;
    const found = tokenHash
      ? await transfers.findMailToken(tokenHash, 'TRANSFER_CONSENT', clock.now())
      : null;
    const transfer = found ? await transfers.findOpenByProfile(found.profileId, clock.now()) : null;
    if (!tokenHash || !found || !transfer || transfer.id !== found.transferId) {
      return failToken(limiter, input.client.ip, clock.now(), new TransferInvalidError());
    }
    await this.consent.give({
      transfer,
      channel: 'EMAIL',
      pinChoice: input.pinChoice,
      ...(input.newPin !== undefined ? { newPin: input.newPin } : {}),
      client: input.client,
    });
    await transfers.consumeMailToken(tokenHash, 'TRANSFER_CONSENT', clock.now());
  }
}

/** PRO-12 : annulation par le lien envoyé au profil pendant le délai d'exécution (publique). */
@Injectable()
export class CancelTransferByEmail {
  constructor(
    private readonly transfers: TransferRepository,
    private readonly tokens: SecretTokens,
    private readonly limiter: RateLimiter,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: { readonly token: string; readonly client: ClientInfo }): Promise<void> {
    const now = this.clock.now();
    const tokenHash = this.tokens.isWellFormed(input.token) ? this.tokens.hash(input.token) : null;
    const found = tokenHash
      ? await this.transfers.findMailToken(tokenHash, 'TRANSFER_CANCEL', now)
      : null;
    if (
      !tokenHash ||
      !found ||
      !(await this.transfers.consumeMailToken(tokenHash, 'TRANSFER_CANCEL', now))
    ) {
      return failToken(this.limiter, input.client.ip, now, new TransferInvalidError());
    }
    if (!(await this.transfers.cancel(found.transferId, now))) throw new TransferInvalidError();
    const subject = await this.transfers.subject(found.profileId);
    if (subject) {
      await log(
        this.securityLog,
        subject.accountId,
        'profile.transfer_cancelled',
        input.client,
        now,
        found,
      );
    }
  }
}

/**
 * PRO-12 : le compte d'arrivée ouvre le jeton de passage. Les contrôles (cercle, blocages, autre
 * compte, hors tutelle) précèdent toute réponse : sinon, refus commun. Les échecs sont comptés par
 * compte (« Limitation »).
 */
@Injectable()
export class InspectTransfer {
  constructor(
    private readonly transfers: TransferRepository,
    private readonly tokens: SecretTokens,
    private readonly limiter: RateLimiter,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly accountId: string;
    readonly token: string;
  }): Promise<TransferPreview> {
    const deps = {
      transfers: this.transfers,
      tokens: this.tokens,
      limiter: this.limiter,
      clock: this.clock,
    };
    return (await receivableTransfer(deps, input)).preview;
  }
}

async function receivableTransfer(
  deps: {
    readonly transfers: TransferRepository;
    readonly tokens: SecretTokens;
    readonly limiter: RateLimiter;
    readonly clock: Clock;
  },
  input: { readonly accountId: string; readonly token: string },
): Promise<{ readonly transfer: TransferState; readonly preview: TransferPreview }> {
  const now = deps.clock.now();
  const subjects = [{ scope: 'transfer_token' as const, parts: [input.accountId] }];
  const check = await deps.limiter.check(subjects, now);
  if (!check.allowed || !check.reservation) throw new RateLimitedError(check.retryAfterMs);
  const transfer = await deps.transfers.findOpenByToken(deps.tokens.hash(input.token), 'MOVE', now);
  const preview =
    transfer && (await deps.transfers.canReceive(transfer.profileId, input.accountId))
      ? await deps.transfers.preview(transfer.id)
      : null;
  if (!transfer || !preview) {
    await deps.limiter.recordFailure(subjects, now, check.reservation);
    throw new TransferInvalidError();
  }
  return { transfer, preview };
}

/** PRO-12 : accord du compte d'arrivée, après ré-authentification (route). */
@Injectable()
export class AcceptTransfer {
  constructor(
    readonly transfers: TransferRepository,
    readonly tokens: SecretTokens,
    readonly limiter: RateLimiter,
    readonly mailer: AccountMailer,
    readonly background: BackgroundTasks,
    readonly securityLog: SecurityLog,
    readonly ids: IdGenerator,
    readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly accountId: string;
    readonly token: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    const { transfer } = await receivableTransfer(this, input);
    const now = this.clock.now();
    if (
      !(await this.transfers.acceptDestination({
        transferId: transfer.id,
        toAccountId: input.accountId,
        now,
      }))
    ) {
      throw new TransferInvalidError();
    }
    const ids = { profileId: transfer.profileId, transferId: transfer.id };
    for (const accountId of [input.accountId, transfer.fromAccountId]) {
      await log(this.securityLog, accountId, 'profile.transfer_consented', input.client, now, ids);
    }
    const after = await this.transfers.findOpenByProfile(transfer.profileId, now);
    if (after?.executesAt) await mailProfile(this, after, 'TRANSFER_CANCEL', now);
  }
}

/** PRO-12 : passages acceptés par le compte d'arrivée, en attente d'exécution. */
@Injectable()
export class ListIncomingTransfers {
  constructor(
    private readonly transfers: TransferRepository,
    private readonly clock: Clock,
  ) {}

  async execute(accountId: string): Promise<IncomingTransfer[]> {
    return this.transfers.listIncoming(accountId, this.clock.now());
  }
}

/** PRO-12 : le compte d'arrivée retire son acceptation tant que le passage n'est pas exécuté. */
@Injectable()
export class WithdrawTransferAcceptance {
  constructor(
    private readonly transfers: TransferRepository,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    readonly accountId: string;
    readonly transferId: string;
    readonly client: ClientInfo;
  }): Promise<void> {
    if (!(await this.transfers.withdrawDestination(input.transferId, input.accountId))) {
      throw new TransferInvalidError();
    }
    await this.securityLog.record({
      accountId: input.accountId,
      transferId: input.transferId,
      event: 'profile.transfer_cancelled',
      ip: input.client.ip,
      userAgent: input.client.userAgent,
      at: this.clock.now(),
    });
  }
}

/**
 * PRO-12, PRO-13 : tâche planifiée. Les passages dont l'échéance est passée s'exécutent (PRO-14) ;
 * les détachements reçoivent leur lien d'installation, sauf adresse déjà prise (la demande est
 * alors close et le titulaire averti). Chaque exécution revérifie tout, sans session.
 */
@Injectable()
export class RunDueTransfers {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly transfers: TransferRepository,
    private readonly effects: TransferEffects,
    private readonly tokens: SecretTokens,
    private readonly mailer: AccountMailer,
    private readonly background: BackgroundTasks,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    let done = 0;
    let firstError: Error | null = null;
    // Revue SEC-40 (I1) : un élément en échec n'arrête pas le lot ; la première erreur remonte
    // ensuite (rapport d'erreur du planificateur).
    for (const due of await this.transfers.due(this.clock.now())) {
      try {
        if (await this.runOne(due)) done += 1;
      } catch (error) {
        firstError ??= error instanceof Error ? error : new Error('Changement de compte en échec');
      }
    }
    if (firstError !== null) throw firstError;
    return done;
  }

  private async runOne(due: {
    readonly id: string;
    readonly kind: 'MOVE' | 'DETACH';
  }): Promise<boolean> {
    if (due.kind === 'MOVE') {
      const result = await this.transfers.execute({
        transferId: due.id,
        now: this.clock.now(),
        linkIds: () => this.ids.next(),
      });
      if (result.status !== 'completed') return false;
      await this.effects.apply(result, due.id, SCHEDULER_CLIENT);
      return true;
    }
    // `due` ne rend un détachement au lien déjà parti que si ce lien a expiré : il est clos.
    if (await this.transfers.setupSent(due.id)) {
      await this.transfers.cancel(due.id, this.clock.now());
      return true;
    }
    await this.sendSetup(due.id);
    return true;
  }

  private async sendSetup(transferId: string): Promise<void> {
    const now = this.clock.now();
    const token = this.tokens.generate();
    if (
      !(await this.transfers.issueSetupToken({
        transferId,
        tokenHash: this.tokens.hash(token),
        tokenExpiresAt: new Date(now.getTime() + ACCOUNT_SETUP_TTL_MS),
        now,
      }))
    ) {
      return;
    }
    const transfer = await this.transfers.findOpenByToken(this.tokens.hash(token), 'DETACH', now);
    const email = transfer?.newEmail;
    if (!transfer || !email) return;
    const existing = await this.accounts.findByEmail(email);
    const taken =
      (existing !== null && existing.emailVerified) ||
      (await this.accounts.isEmailReserved(email, null, now));
    if (taken) {
      // PRO-13 : rien n'est créé ; le titulaire est averti, la demande close.
      await this.transfers.cancel(transfer.id, now);
      this.background.run('transfer.detach_taken', async () => {
        await this.mailer.send(email, { kind: 'email_taken_notice' });
      });
      return;
    }
    this.background.run('transfer.detach_setup', async () => {
      await this.mailer.send(email, { kind: 'detach_setup', token });
    });
  }
}
