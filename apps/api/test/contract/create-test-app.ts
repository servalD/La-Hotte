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
  SecurityLog,
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
} from '../../src/modules/events/testing';
import {
  CommentRepository,
  ConversationPeople,
  FollowRepository,
  InMemoryCommentRepository,
  InMemoryConversationPeople,
  InMemoryFollowRepository,
} from '../../src/modules/conversations/testing';
import { InProcessAppEvents } from '../../src/platform/events/in-process-app-events';

/** Doubles du module `conversations` (phase 4). */
export interface TestConversations {
  readonly comments: InMemoryCommentRepository;
  readonly follows: InMemoryFollowRepository;
  readonly people: InMemoryConversationPeople;
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
}

/** Doubles des modules de la phase 2. */
export interface TestCatalog {
  readonly products: InMemoryProductRepository;
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
}> {
  const previousEnv = { ...process.env };
  Object.assign(process.env, options.env ?? {});

  const sessions = new InMemorySessionStore();
  const securityLog = new InMemorySecurityLog();
  const mail = new InMemoryMailSender();
  const accounts = new InMemoryAccountRepository(sessions);
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
  };
  const conversations: TestConversations = {
    comments: new InMemoryCommentRepository(),
    follows: new InMemoryFollowRepository(),
    people: new InMemoryConversationPeople(),
    settle: () => app.get(InProcessAppEvents).drain(),
  };
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
    .overrideProvider(SecurityLog)
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
    .overrideProvider(FollowRepository)
    .useValue(conversations.follows)
    .overrideProvider(ConversationPeople)
    .useValue(conversations.people)
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
    async signIn({
      pin = false,
      relock = 'IDLE_15',
      withProfile = true,
      isChild = false,
      displayName,
    } = {}) {
      const accountId = randomUUID();
      const profileId = randomUUID();
      sessions.addAccount(accountId);
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
  return { app, identity, catalog, events, conversations };
}
