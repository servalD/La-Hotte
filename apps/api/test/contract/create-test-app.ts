import { randomUUID } from 'node:crypto';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import {
  AccountRepository,
  BackgroundTasks,
  EventThrottle,
  FakeGoogleOidc,
  FakePasswordHasher,
  GoogleIdentityRepository,
  GoogleOidc,
  GoogleReauthProofs,
  InMemoryGoogleIdentityRepository,
  InMemoryGoogleReauthProofs,
  InMemoryOidcFlows,
  OidcFlows,
  IdentitySettings,
  InMemoryAccountRepository,
  InMemoryBackgroundTasks,
  InMemoryBreachChecker,
  InMemoryEventThrottle,
  InMemoryLinkRepository,
  InMemoryMailSender,
  InMemoryPendingSecondFactors,
  InMemorySecondFactorRepository,
  InMemoryTrustedDeviceRepository,
  InMemoryProfileLockPolicies,
  InMemoryProfileRepository,
  InMemoryRateLimiter,
  LinkRepository,
  InMemorySecurityLog,
  InMemorySessionStore,
  MailSender,
  PasswordBreachChecker,
  PasswordHasher,
  PendingSecondFactors,
  ProfileLockPolicies,
  ProfileRepository,
  RateLimiter,
  SecondFactorRepository,
  SecurityLogStore,
  SessionStore,
  StaticIdentitySettings,
  TrustedDeviceRepository,
  InMemoryWardRepository,
  WardRepository,
  InMemoryTransferRepository,
  TransferRepository,
} from '../../src/modules/identity/testing';
import type { PinRelock } from '../../src/modules/identity/domain/session';
import { type SignedIn, signIn } from '../support/sign-in';
import {
  ExtractionCache,
  ExtractionQueue,
  FakePageFetcher,
  FakeProductExtractor,
  InMemoryExtractionCache,
  ManualExtractionQueue,
  ProductExtractor,
  RunExtraction,
  ImageStore,
  InMemoryImageStore,
  InMemoryProductRepository,
  PageFetcher,
  ProductRepository,
  InMemoryPublisherPolicy,
  PublisherPolicy,
} from '../../src/modules/catalog/testing';
import {
  EngagementReader,
  EventLookup,
  InMemoryEngagementReader,
  InMemoryEventLookup,
  InMemoryItemRepository,
  InMemoryListRepository,
  InMemoryVisibilityLog,
  ItemRepository,
  ListRepository,
  VisibilityLogRepository,
} from '../../src/modules/lists/testing';
import {
  CompleteEvents,
  EventLinkRepository,
  EventPeople,
  EventRepository,
  InMemoryEventLinkRepository,
  InMemoryEventPeople,
  InMemoryEventRepository,
  RecordingResponseFloor,
  ResponseFloor,
  SendEventReminders,
  EventEngagements,
  InMemoryEventEngagements,
} from '../../src/modules/events/testing';
import {
  CommentRepository,
  ConversationPeople,
  FollowRepository,
  InMemoryCommentRepository,
  InMemoryConversationPeople,
  InMemoryFollowRepository,
} from '../../src/modules/conversations/testing';
import {
  InMemoryNotificationPeople,
  InMemoryNotificationRepository,
  InMemoryPreferenceRepository,
  NotificationPeople,
  NotificationRepository,
  PreferenceRepository,
  DeliverPushes,
  DeliveryGateway,
  DigestRepository,
  InMemoryDeliveryGateway,
  InMemoryDigestRepository,
  InMemoryPushSubscriptionRepository,
  PushSender,
  PushSubscriptionRepository,
  RecordingPushSender,
  SendDigests,
} from '../../src/modules/notifications/testing';
import {
  AccountDirectory,
  AccountSearchQuota,
  AuditTrail,
  EraseRemovedComments,
  InMemoryAccountSearchQuota,
  InMemoryAuditTrail,
  InMemoryModerationStore,
  ModerationStore,
} from '../../src/modules/admin/testing';
import {
  AccountAdministration,
  AccountLifecycle,
  EraseDueAccounts,
  HandleInactiveAccounts,
  InMemoryAccountAdministration,
  InMemoryAccountLifecycle,
} from '../../src/modules/identity/testing';
import { DataExportStore, InMemoryDataExportStore } from '../../src/modules/privacy/testing';
import { InMemoryPlatformSettings } from '../../src/platform/settings/in-memory-platform-settings';
import { AuditJournal, PlatformSettings } from '../../src/shared/domain';
import { InMemoryAccountDirectory } from './in-memory-account-directory';
import type { AccountRole } from '../../src/modules/identity/domain/session';
import { InProcessAppEvents } from '../../src/platform/events/in-process-app-events';
import { IdempotencyStore, InMemoryIdempotencyStore } from '../../src/platform/http/idempotency';
import {
  AccountingPeople,
  AccountingRepository,
  BudgetRepository,
  InMemoryAccountingPeople,
  InMemoryAccountingRepository,
  InMemoryBudgetRepository,
} from '../../src/modules/accounting/testing';

/** Doubles du module `admin` (phase 7). */
export interface TestAdmin {
  readonly audit: InMemoryAuditTrail;
  readonly settings: InMemoryPlatformSettings;
  readonly searchQuota: InMemoryAccountSearchQuota;
  readonly administration: InMemoryAccountAdministration;
  readonly moderation: InMemoryModerationStore;
  /** RGPD-11 : fichiers d'export (en clair dans le double). */
  readonly exports: InMemoryDataExportStore;
  /** MOD-11 : lance l'effacement des messages retirés, comme la tâche du processus. */
  eraseRemovedComments(): Promise<number>;
}

/** Doubles du module `accounting` (phase 5). */
export interface TestAccounting {
  readonly repository: InMemoryAccountingRepository;
  readonly people: InMemoryAccountingPeople;
  readonly budgets: InMemoryBudgetRepository;
}

/** Doubles du module `conversations` (phase 4). */
export interface TestConversations {
  readonly comments: InMemoryCommentRepository;
  readonly follows: InMemoryFollowRepository;
  readonly people: InMemoryConversationPeople;
  readonly notifications: InMemoryNotificationRepository;
  readonly preferences: InMemoryPreferenceRepository;
  readonly notificationPeople: InMemoryNotificationPeople;
  readonly push: InMemoryPushSubscriptionRepository;
  readonly pushSender: RecordingPushSender;
  readonly delivery: InMemoryDeliveryGateway;
  readonly digests: InMemoryDigestRepository;
  /** NOT-15 : exécute la tâche des push dues. */
  deliverPushes(): Promise<number>;
  /** NOT-17 : exécute la tâche des résumés. */
  sendDigests(): Promise<number>;
  /** Attend la livraison des événements de domaine (ADR 0018). */
  settle(): Promise<void>;
}

/** Doubles du module `events` (phase 3). */
export interface TestEvents {
  readonly events: InMemoryEventRepository;
  readonly links: InMemoryEventLinkRepository;
  readonly people: InMemoryEventPeople;
  /** EVT-16 : refus passés par le temps plancher (sans attente en test). */
  readonly floor: RecordingResponseFloor;
  /** EVT-33 : exécute la tâche planifiée. */
  complete(): Promise<number>;
  /** EVT-13, EVT-32 : exécute la tâche des rappels. */
  remind(): Promise<number>;
}

/** Doubles des modules de la phase 2. */
export interface TestCatalog {
  readonly products: InMemoryProductRepository;
  /** MOD-12 : profils enfants (lus dans `identity`) et suspensions de publication. */
  readonly publishers: InMemoryPublisherPolicy;
  readonly images: InMemoryImageStore;
  readonly fetcher: FakePageFetcher;
  readonly extractor: FakeProductExtractor;
  readonly extractionCache: InMemoryExtractionCache;
  readonly extractionQueue: ManualExtractionQueue;
  /** Exécute les extractions en file (EXT-06), comme le ferait la file du processus. */
  runExtractions(): Promise<void>;
  readonly lists: InMemoryListRepository;
  readonly items: InMemoryItemRepository;
  readonly visibilityLog: InMemoryVisibilityLog;
  readonly engagements: InMemoryEngagementReader;
  /** EVT-29 : événements lus par `lists`, reliés au double des événements. */
  readonly eventLookup: InMemoryEventLookup;
}

export interface TestIdentity {
  readonly sessions: InMemorySessionStore;
  readonly profiles: InMemoryProfileLockPolicies;
  /** Même magasin que `profiles` et `accounts.profiles`. */
  readonly profileRepository: InMemoryProfileRepository;
  readonly securityLog: InMemorySecurityLog;
  readonly mail: InMemoryMailSender;
  readonly accounts: InMemoryAccountRepository;
  readonly hasher: FakePasswordHasher;
  readonly breaches: InMemoryBreachChecker;
  readonly background: InMemoryBackgroundTasks;
  readonly rateLimiter: InMemoryRateLimiter;
  /** Limitation des lignes de journal et des avis (une fois par fenêtre) ; `reset()` entre les tests. */
  readonly eventThrottle: InMemoryEventThrottle;
  readonly settings: StaticIdentitySettings;
  readonly secondFactors: InMemorySecondFactorRepository;
  readonly trustedDevices: InMemoryTrustedDeviceRepository;
  readonly pendingSecondFactors: InMemoryPendingSecondFactors;
  readonly google: FakeGoogleOidc;
  readonly oidcFlows: InMemoryOidcFlows;
  readonly googleReauthProofs: InMemoryGoogleReauthProofs;
  readonly googleIdentities: InMemoryGoogleIdentityRepository;
  /** Liens, blocages et invitations (LNK-01 à LNK-10) ; profils partagés avec `accounts`. */
  readonly links: InMemoryLinkRepository;
  /** Comptes sous tutelle (PRO-15, PRO-16) ; comptes, profils et liens partagés. */
  readonly wards: InMemoryWardRepository;
  /** Passages, détachements (PRO-12 à PRO-14). */
  readonly transfers: InMemoryTransferRepository;
  /** RGPD-12, RGPD-13 : demandes d'effacement, avertissements d'inactivité. */
  readonly lifecycle: InMemoryAccountLifecycle;
  /** Lance les tâches du cycle de vie des comptes, comme le planificateur. */
  runAccountLifecycle(): Promise<{ erased: number; warned: number; scheduled: number }>;
  /**
   * Compte neuf avec un profil actif ; sans PIN par défaut (donc déverrouillé), `TEST_PIN`
   * sinon. `withProfile: false` : compte sans aucun profil.
   */
  signIn(options?: {
    pin?: boolean;
    relock?: PinRelock;
    withProfile?: boolean;
    /** PRO-05 : profil enfant. */
    isChild?: boolean;
    displayName?: string;
    /** RBAC-01 : rôle de plateforme du compte (`USER` par défaut). */
    role?: AccountRole;
  }): Promise<SignedIn>;
}

/** Application montée avec ses vrais réglages (filtre, validation, en-têtes, gardes), ports en mémoire. */
export async function createTestApp(
  options: { controllers?: Type[]; env?: Record<string, string> } = {},
): Promise<{
  app: INestApplication;
  identity: TestIdentity;
  catalog: TestCatalog;
  events: TestEvents;
  conversations: TestConversations;
  accounting: TestAccounting;
  admin: TestAdmin;
}> {
  const previousEnv = { ...process.env };
  Object.assign(process.env, options.env ?? {});

  const sessions = new InMemorySessionStore();
  const audit = new InMemoryAuditTrail();
  const publishers = new InMemoryPublisherPolicy();
  const exports = new InMemoryDataExportStore();
  const moderation = new InMemoryModerationStore((write) => {
    audit.append(write);
  });
  const platformSettings = new InMemoryPlatformSettings((write) => {
    audit.append(write);
  });
  const searchQuota = new InMemoryAccountSearchQuota();
  const securityLog = new InMemorySecurityLog();
  const mail = new InMemoryMailSender();
  const accounts = new InMemoryAccountRepository(sessions);
  const lifecycle = new InMemoryAccountLifecycle(sessions, accounts);
  const administration = new InMemoryAccountAdministration(sessions, accounts, (write) => {
    audit.append(write);
  });
  const profiles = new InMemoryProfileLockPolicies(accounts.profiles);
  const profileRepository = new InMemoryProfileRepository(accounts.profiles, sessions);
  const hasher = new FakePasswordHasher();
  const breaches = new InMemoryBreachChecker();
  const background = new InMemoryBackgroundTasks();
  const rateLimiter = new InMemoryRateLimiter();
  const eventThrottle = new InMemoryEventThrottle();
  const settings = new StaticIdentitySettings();
  const secondFactors = new InMemorySecondFactorRepository(accounts, sessions);
  const trustedDevices = new InMemoryTrustedDeviceRepository(accounts);
  const pendingSecondFactors = new InMemoryPendingSecondFactors();
  const google = new FakeGoogleOidc();
  const oidcFlows = new InMemoryOidcFlows();
  const googleReauthProofs = new InMemoryGoogleReauthProofs();
  const googleIdentities = new InMemoryGoogleIdentityRepository(accounts, sessions);
  const links = new InMemoryLinkRepository(accounts);
  const wards = new InMemoryWardRepository(accounts, links);
  // PRO-12, PRO-15 : le double des profils consulte les règles de tutelle des comptes et des liens.
  profileRepository.guardianRules = wards;
  const transfers = new InMemoryTransferRepository(accounts, links, wards, sessions);
  const products = new InMemoryProductRepository();
  const visibilityLog = new InMemoryVisibilityLog();
  const catalog: TestCatalog = {
    products,
    publishers,
    images: new InMemoryImageStore(),
    fetcher: new FakePageFetcher(),
    extractor: new FakeProductExtractor(),
    extractionCache: new InMemoryExtractionCache(),
    extractionQueue: new ManualExtractionQueue(),
    runExtractions: () => catalog.extractionQueue.drain(app.get(RunExtraction)),
    lists: new InMemoryListRepository(visibilityLog),
    items: new InMemoryItemRepository(products, visibilityLog),
    visibilityLog,
    engagements: new InMemoryEngagementReader(),
    eventLookup: new InMemoryEventLookup(),
  };
  const eventRepository = new InMemoryEventRepository();
  const events: TestEvents = {
    events: eventRepository,
    links: new InMemoryEventLinkRepository(eventRepository),
    people: new InMemoryEventPeople(),
    floor: new RecordingResponseFloor(),
    complete: () => app.get(CompleteEvents).execute(),
    remind: () => app.get(SendEventReminders).execute(),
  };
  const notificationRows = new InMemoryNotificationRepository();
  const notificationPrefs = new InMemoryPreferenceRepository();
  const conversations: TestConversations = {
    comments: new InMemoryCommentRepository(),
    follows: new InMemoryFollowRepository(),
    people: new InMemoryConversationPeople(),
    notifications: notificationRows,
    preferences: notificationPrefs,
    notificationPeople: new InMemoryNotificationPeople(),
    push: new InMemoryPushSubscriptionRepository(notificationRows),
    pushSender: new RecordingPushSender(),
    delivery: new InMemoryDeliveryGateway(),
    digests: new InMemoryDigestRepository(notificationRows, notificationPrefs),
    deliverPushes: () => app.get(DeliverPushes).execute(),
    sendDigests: () => app.get(SendDigests).execute(),
    settle: () => app.get(InProcessAppEvents).drain(),
  };
  const accounting: TestAccounting = {
    // LST-11, LST-12 : l'état réel de l'élément suit la compta, comme dans la transaction réelle.
    repository: new InMemoryAccountingRepository((itemId, status) => {
      const row = catalog.items.items.get(itemId);
      if (row && row.status !== 'WITHDRAWN') catalog.items.items.set(itemId, { ...row, status });
    }),
    people: new InMemoryAccountingPeople(),
    budgets: new InMemoryBudgetRepository(),
  };
  const idempotency = new InMemoryIdempotencyStore();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(SessionStore)
    .useValue(sessions)
    .overrideProvider(ProfileLockPolicies)
    .useValue(profiles)
    .overrideProvider(ProfileRepository)
    .useValue(profileRepository)
    .overrideProvider(RateLimiter)
    .useValue(rateLimiter)
    .overrideProvider(EventThrottle)
    .useValue(eventThrottle)
    .overrideProvider(SecurityLogStore)
    .useValue(securityLog)
    .overrideProvider(MailSender)
    .useValue(mail)
    .overrideProvider(AccountRepository)
    .useValue(accounts)
    .overrideProvider(PasswordHasher)
    .useValue(hasher)
    .overrideProvider(PasswordBreachChecker)
    .useValue(breaches)
    .overrideProvider(BackgroundTasks)
    .useValue(background)
    .overrideProvider(IdentitySettings)
    .useValue(settings)
    .overrideProvider(SecondFactorRepository)
    .useValue(secondFactors)
    .overrideProvider(TrustedDeviceRepository)
    .useValue(trustedDevices)
    .overrideProvider(PendingSecondFactors)
    .useValue(pendingSecondFactors)
    .overrideProvider(GoogleOidc)
    .useValue(google)
    .overrideProvider(OidcFlows)
    .useValue(oidcFlows)
    .overrideProvider(GoogleReauthProofs)
    .useValue(googleReauthProofs)
    .overrideProvider(GoogleIdentityRepository)
    .useValue(googleIdentities)
    .overrideProvider(LinkRepository)
    .useValue(links)
    .overrideProvider(WardRepository)
    .useValue(wards)
    .overrideProvider(TransferRepository)
    .useValue(transfers)
    .overrideProvider(ProductRepository)
    .useValue(catalog.products)
    .overrideProvider(ImageStore)
    .useValue(catalog.images)
    .overrideProvider(PageFetcher)
    .useValue(catalog.fetcher)
    .overrideProvider(ProductExtractor)
    .useValue(catalog.extractor)
    .overrideProvider(ExtractionCache)
    .useValue(catalog.extractionCache)
    .overrideProvider(ExtractionQueue)
    .useValue(catalog.extractionQueue)
    .overrideProvider(ListRepository)
    .useValue(catalog.lists)
    .overrideProvider(ItemRepository)
    .useValue(catalog.items)
    .overrideProvider(VisibilityLogRepository)
    .useValue(catalog.visibilityLog)
    .overrideProvider(EngagementReader)
    .useValue(catalog.engagements)
    .overrideProvider(EventEngagements)
    .useValue(new InMemoryEventEngagements())
    .overrideProvider(EventLookup)
    .useValue(catalog.eventLookup)
    .overrideProvider(EventRepository)
    .useValue(events.events)
    .overrideProvider(EventLinkRepository)
    .useValue(events.links)
    .overrideProvider(EventPeople)
    .useValue(events.people)
    .overrideProvider(ResponseFloor)
    .useValue(events.floor)
    .overrideProvider(CommentRepository)
    .useValue(conversations.comments)
    .overrideProvider(AccountingRepository)
    .useValue(accounting.repository)
    .overrideProvider(AccountingPeople)
    .useValue(accounting.people)
    .overrideProvider(BudgetRepository)
    .useValue(accounting.budgets)
    .overrideProvider(FollowRepository)
    .useValue(conversations.follows)
    .overrideProvider(ConversationPeople)
    .useValue(conversations.people)
    .overrideProvider(NotificationRepository)
    .useValue(conversations.notifications)
    .overrideProvider(PreferenceRepository)
    .useValue(conversations.preferences)
    .overrideProvider(NotificationPeople)
    .useValue(conversations.notificationPeople)
    .overrideProvider(PushSubscriptionRepository)
    .useValue(conversations.push)
    .overrideProvider(PushSender)
    .useValue(conversations.pushSender)
    .overrideProvider(DeliveryGateway)
    .useValue(conversations.delivery)
    .overrideProvider(DigestRepository)
    .useValue(conversations.digests)
    .overrideProvider(DataExportStore)
    .useValue(exports)
    .overrideProvider(ModerationStore)
    .useValue(moderation)
    .overrideProvider(PublisherPolicy)
    .useValue(publishers)
    .overrideProvider(AuditTrail)
    .useValue(audit)
    .overrideProvider(AuditJournal)
    .useValue({
      append: (write: Parameters<AuditJournal['append']>[0]) => {
        audit.append(write);
        return Promise.resolve();
      },
    })
    .overrideProvider(PlatformSettings)
    .useValue(platformSettings)
    .overrideProvider(AccountLifecycle)
    .useValue(lifecycle)
    .overrideProvider(AccountAdministration)
    .useValue(administration)
    .overrideProvider(AccountDirectory)
    .useValue(new InMemoryAccountDirectory(sessions, accounts, administration, audit))
    .overrideProvider(AccountSearchQuota)
    .useValue(searchQuota)
    .overrideProvider(IdempotencyStore)
    .useValue(idempotency)
    .compile();

  // Doubles des événements reliés à ceux d'`identity` et des listes.
  const cardOf = (profileId: string) => {
    const p = accounts.profiles.get(profileId);
    return p
      ? {
          id: profileId,
          displayName: p.displayName,
          avatar: p.avatar ?? null,
          accentColor: p.accentColor,
        }
      : null;
  };
  events.events.cardOf = cardOf;
  conversations.people.cardOf = cardOf;
  conversations.notificationPeople.nameOf = (id) => accounts.profiles.get(id)?.displayName ?? null;
  conversations.digests.profile = (id) => {
    const p = accounts.profiles.get(id);
    return p ? { accountId: p.accountId, name: p.displayName } : null;
  };
  conversations.notificationPeople.accountProfiles = (accountId) =>
    [...accounts.profiles.values()].filter((p) => p.accountId === accountId).map((p) => p.id);
  events.events.revokeLinks = (eventId, at) => {
    events.links.revokeAll(eventId, at);
  };
  events.events.revokeLinksOf = (eventId, profileId, at) => {
    void events.links.revokeCreatedBy(eventId, profileId, at);
  };
  events.events.tiedToLists = (eventId, profileIds) =>
    [...catalog.lists.lists.values()].some(
      (list) =>
        list.event?.id === eventId &&
        (list.members.some((m) => profileIds.includes(m.profileId)) ||
          (list.type === 'WISHLIST' && list.recipients.some((r) => profileIds.includes(r)))),
    );
  events.events.detachLists = (eventId, archiveAt) => {
    for (const [id, list] of catalog.lists.lists) {
      if (list.event?.id !== eventId) continue;
      catalog.lists.lists.set(id, {
        ...list,
        event: null,
        audience: list.audience === 'EVENT' ? 'MEMBERS' : list.audience,
        archivedAt: list.archivedAt ?? archiveAt,
      });
    }
  };
  events.people.settingsOf = (profileId) => {
    const p = accounts.profiles.get(profileId);
    return p ? { timezone: p.timezone, currency: p.currency, isChild: p.isChild ?? false } : null;
  };
  events.people.blocked = (a, b) => links.isBlockedEitherWay(a, b);
  // EVT-14, EVT-29, EVT-38 : les listes lisent l'événement à jour dans le double des événements.
  const storedEvent = (eventId: string) => events.events.events.get(eventId) ?? null;
  catalog.lists.eventFactsOf = (eventId) => {
    const e = storedEvent(eventId);
    return e
      ? {
          id: e.id,
          audience: e.participants
            .filter((p) => p.rsvp === 'YES' || p.rsvp === 'MAYBE')
            .map((p) => p.profileId),
          closed: e.status !== 'UPCOMING',
          hiddenFrom: [...e.surprise],
        }
      : null;
  };
  catalog.eventLookup.findEvent = (eventId) => {
    const e = storedEvent(eventId);
    return e
      ? {
          id: e.id,
          title: e.title,
          mode: e.mode,
          isSurprise: e.isSurprise,
          status: e.status,
          participants: e.participants.map((p) => ({
            profileId: p.profileId,
            role: p.role,
            isHonoree: p.isHonoree,
            rsvp: p.rsvp,
          })),
        }
      : null;
  };
  catalog.eventLookup.surpriseOf = (eventId) => [...(storedEvent(eventId)?.surprise ?? [])];
  catalog.items.listContext = (listId) => {
    const list = catalog.lists.lists.get(listId);
    if (!list) return null;
    const e = list.event ? storedEvent(list.event.id) : null;
    return {
      isWishlist: list.type === 'WISHLIST',
      deleted: list.deletedAt !== null,
      recipients: list.recipients,
      event: e
        ? {
            id: e.id,
            title: e.title,
            date: e.date,
            timezone: e.timezone,
            closed: e.status !== 'UPCOMING',
          }
        : null,
    };
  };
  catalog.items.eventOfList = (listId) => {
    const eventId = catalog.lists.lists.get(listId)?.event?.id;
    const e = eventId ? storedEvent(eventId) : null;
    return e ? { id: e.id, title: e.title, date: e.date } : null;
  };

  products.accountOf = (profileId) => accounts.profiles.get(profileId)?.accountId;
  publishers.isChildOf = (profileId) => accounts.profiles.get(profileId)?.isChild === true;
  publishers.isSuspendedOf = (profileId) => {
    const accountId = accounts.profiles.get(profileId)?.accountId;
    return accountId !== undefined && administration.publicationSuspended.has(accountId);
  };
  moderation.authorOf = (target) =>
    target.kind === 'PRODUCT'
      ? (products.rows.get(target.id)?.ownerProfileId ?? null)
      : (conversations.comments.comments.get(target.id)?.authorId ?? null);
  moderation.isLiveRemovedComment = (id) => {
    const row = conversations.comments.comments.get(id);
    return Boolean(row?.moderatedAt) && !row?.deletedAt;
  };
  catalog.items.recipientsOf = (listId) => catalog.lists.lists.get(listId)?.recipients ?? [];
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  process.env = previousEnv;

  const identity: TestIdentity = {
    sessions,
    profiles,
    profileRepository,
    securityLog,
    mail,
    accounts,
    hasher,
    breaches,
    background,
    rateLimiter,
    eventThrottle,
    settings,
    secondFactors,
    trustedDevices,
    pendingSecondFactors,
    google,
    oidcFlows,
    googleReauthProofs,
    googleIdentities,
    links,
    wards,
    transfers,
    lifecycle,
    async runAccountLifecycle() {
      const { warned, scheduled } = await app.get(HandleInactiveAccounts).execute();
      const erased = await app.get(EraseDueAccounts).execute();
      return { erased, warned, scheduled };
    },
    async signIn({
      pin = false,
      relock = 'IDLE_15',
      withProfile = true,
      isChild = false,
      displayName,
      role = 'USER',
    } = {}) {
      const accountId = randomUUID();
      const profileId = randomUUID();
      sessions.addAccount(accountId, role);
      if (withProfile) profiles.set({ profileId, accountId, hasPin: pin, relock });
      const created = accounts.profiles.get(profileId);
      if (created && withProfile) {
        accounts.profiles.set(profileId, {
          ...created,
          isChild,
          ...(displayName ? { displayName } : {}),
        });
      }
      return signIn(app, { accountId, profileId: withProfile ? profileId : null });
    },
  };
  return {
    app,
    identity,
    catalog,
    events,
    conversations,
    accounting,
    admin: {
      audit,
      settings: platformSettings,
      searchQuota,
      administration,
      moderation,
      exports,
      eraseRemovedComments: () => app.get(EraseRemovedComments).execute(),
    },
  };
}
