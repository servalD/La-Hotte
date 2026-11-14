import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountMailer } from './application/account-mailer';
import { AuthorizeProfile } from './application/authorize-profile.use-case';
import { CancelEmailChange } from './application/cancel-email-change.use-case';
import { ChangePassword } from './application/change-password.use-case';
import { CheckSessionAccess } from './application/check-session-access.use-case';
import { ConfirmPasswordReset } from './application/confirm-password-reset.use-case';
import { ListSessions, RevokeSession, SignOut } from './application/manage-sessions.use-case';
import { PasswordPolicy } from './application/password-policy';
import { PurgeUnverifiedAccounts } from './application/purge-unverified-accounts.use-case';
import { Reauthenticate } from './application/reauthenticate.use-case';
import { RegisterAccount } from './application/register-account.use-case';
import { ReportCsrfRejection } from './application/report-csrf-rejection.use-case';
import { RequestEmailChange } from './application/request-email-change.use-case';
import { RequestPasswordReset } from './application/request-password-reset.use-case';
import { ResolveSession } from './application/resolve-session.use-case';
import { SessionLifecycle } from './application/session-lifecycle';
import { SignInWithPassword } from './application/sign-in-with-password.use-case';
import { VerifyEmail } from './application/verify-email.use-case';
import { DisableTotp } from './application/disable-totp.use-case';
import { ActivateTotp, StartTotpEnrollment } from './application/enroll-totp.use-case';
import { GetAccount } from './application/get-account.use-case';
import {
  ListTrustedDevices,
  RevokeTrustedDevice,
} from './application/manage-trusted-devices.use-case';
import { RegenerateRecoveryCodes } from './application/regenerate-recovery-codes.use-case';
import { SecondFactorVerifier } from './application/second-factor-verifier';
import { VerifySecondFactor } from './application/verify-second-factor.use-case';
import { CompleteGoogleFlow } from './application/complete-google-flow.use-case';
import { SignInCompletion } from './application/sign-in-completion';
import { StartGoogleFlow } from './application/start-google-flow.use-case';
import { UnlinkGoogle } from './application/unlink-google.use-case';
import {
  GoogleIdentityRepository,
  GoogleOidc,
  GoogleReauthProofs,
  OidcFlows,
} from './domain/google.ports';
import { OpenIdGoogleOidc } from './infrastructure/openid-google-oidc';
import { PrismaGoogleIdentityRepository } from './infrastructure/prisma-google-identity-repository';
import { RedisGoogleReauthProofs, RedisOidcFlows } from './infrastructure/redis-oidc-flows';
import { GoogleController } from './presentation/google.controller';
import {
  PendingSecondFactors,
  SecondFactorRepository,
  SecretCipher,
  TotpEngine,
  TrustedDeviceRepository,
} from './domain/second-factor.ports';
import { AesGcmSecretCipher } from './infrastructure/aes-secret-cipher';
import { OtplibTotpEngine } from './infrastructure/otplib-totp-engine';
import {
  PrismaSecondFactorRepository,
  PrismaTrustedDeviceRepository,
} from './infrastructure/prisma-second-factor-repository';
import { RedisPendingSecondFactors } from './infrastructure/redis-pending-second-factors';
import { AccountController, TrustedDevicesController } from './presentation/account.controller';
import {
  AccountRepository,
  BackgroundTasks,
  IdentitySettings,
  PasswordBreachChecker,
  PasswordHasher,
} from './domain/account.ports';
import {
  CsrfTokens,
  EventThrottle,
  IdentityEvents,
  MailSender,
  ProfileLockPolicies,
  RateLimiter,
  SecretTokens,
  SecurityLog,
  SessionStore,
} from './domain/ports';
import {
  InProcessIdentityEvents,
  PrismaProfileLockPolicies,
  PrismaSecurityLog,
  SmtpMailSender,
} from './infrastructure/adapters';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher';
import { CryptoSecretTokens, HmacCsrfTokens } from './infrastructure/crypto-tokens';
import { HibpBreachChecker } from './infrastructure/hibp-breach-checker';
import {
  EnvIdentitySettings,
  InProcessBackgroundTasks,
} from './infrastructure/in-process-background-tasks';
import { PrismaAccountRepository } from './infrastructure/prisma-account-repository';
import { RedisEventThrottle, RedisRateLimiter } from './infrastructure/redis-rate-limiter';
import { RedisSessionStore } from './infrastructure/redis-session-store';
import { AuthController } from './presentation/auth.controller';
import { IdentityGuardChain } from './presentation/guard-chain.guard';
import { SessionController } from './presentation/session.controller';
import { SessionsController } from './presentation/sessions.controller';
import { UnverifiedPurgeScheduler } from './presentation/unverified-purge.scheduler';
import {
  CreateAccountProfile,
  DeleteAccountProfile,
  DisableProfilePin,
  ListAccountProfiles,
  ResetProfilePin,
  SetProfileChildMarker,
} from './application/manage-account-profiles.use-case';
import {
  GetOwnProfile,
  SetOwnPin,
  UpdateOwnProfile,
} from './application/manage-own-profile.use-case';
import { PinVerifier } from './application/pin-verifier';
import { LockSession, SelectProfile } from './application/select-profile.use-case';
import { ProfileRepository } from './domain/profile.ports';
import { PrismaProfileRepository } from './infrastructure/prisma-profile-repository';
import {
  AccountProfilesController,
  ProfileEmailVerificationController,
  ProfilesController,
} from './presentation/profiles.controller';
import {
  ApproveLink,
  BlockProfile,
  BreakLink,
  CreateInvitation,
  InspectInvitation,
  ListBlocks,
  ListCircle,
  ListInvitations,
  ListLinks,
  RedeemInvitation,
  RevokeInvitation,
  UnblockProfile,
} from './application/manage-links.use-case';
import { RemoveUnverifiedAccount } from './application/remove-unverified-account';
import { CircleReader, LinkRepository } from './domain/link.ports';
import { PrismaLinkRepository } from './infrastructure/prisma-link-repository';
import {
  BlocksController,
  CircleController,
  InvitationsController,
  LinksController,
} from './presentation/links.controller';
import {
  AttestAgeForRelease,
  CreateWard,
  CreateWardProfile,
  GetWard,
  ListWards,
  RequestWardRelease,
  ResetWardPassword,
  RevokeWardSessions,
  SetupWardAccount,
} from './application/manage-wards.use-case';
import { GuardianNotices } from './application/guardian-notices';
import {
  AcceptProfileInvitation,
  DecideProfileProposal,
  InspectProfileInvitation,
  ListProfileProposals,
} from './application/profile-invitations.use-case';
import {
  ProfileInvitationsController,
  ProfileProposalsController,
} from './presentation/profile-invitations.controller';
import {
  ClearOwnEmail,
  SetOwnEmail,
  VerifyProfileEmail,
} from './application/profile-email.use-case';
import { WardRepository } from './domain/ward.ports';
import { PrismaWardRepository } from './infrastructure/prisma-ward-repository';
import {
  AccountSetupController,
  AgeAttestationController,
  WardsController,
} from './presentation/wards.controller';

/**
 * Module `identity` (ADR 0011, ADR 0013) : sessions, gardes, limitation, journal de sécurité,
 * comptes par mot de passe, second facteur (TOTP, codes de secours, appareils de confiance),
 * connexion avec Google (OpenID Connect).
 */
@Module({
  controllers: [
    SessionController,
    SessionsController,
    AuthController,
    GoogleController,
    AccountController,
    TrustedDevicesController,
    ProfilesController,
    AccountProfilesController,
    CircleController,
    LinksController,
    InvitationsController,
    BlocksController,
    WardsController,
    AgeAttestationController,
    AccountSetupController,
    ProfileEmailVerificationController,
    ProfileProposalsController,
    ProfileInvitationsController,
  ],
  providers: [
    ResolveSession,
    AuthorizeProfile,
    CheckSessionAccess,
    SessionLifecycle,
    ReportCsrfRejection,
    AccountMailer,
    PasswordPolicy,
    RegisterAccount,
    SignInWithPassword,
    SignOut,
    Reauthenticate,
    VerifyEmail,
    CancelEmailChange,
    RequestPasswordReset,
    ConfirmPasswordReset,
    ChangePassword,
    RequestEmailChange,
    ListSessions,
    RevokeSession,
    PurgeUnverifiedAccounts,
    UnverifiedPurgeScheduler,
    SecondFactorVerifier,
    VerifySecondFactor,
    StartTotpEnrollment,
    ActivateTotp,
    DisableTotp,
    RegenerateRecoveryCodes,
    ListTrustedDevices,
    RevokeTrustedDevice,
    GetAccount,
    SignInCompletion,
    StartGoogleFlow,
    CompleteGoogleFlow,
    UnlinkGoogle,
    PinVerifier,
    SelectProfile,
    LockSession,
    GetOwnProfile,
    UpdateOwnProfile,
    SetOwnPin,
    ListAccountProfiles,
    CreateAccountProfile,
    DeleteAccountProfile,
    ResetProfilePin,
    DisableProfilePin,
    SetProfileChildMarker,
    RemoveUnverifiedAccount,
    CreateInvitation,
    ListInvitations,
    RevokeInvitation,
    InspectInvitation,
    RedeemInvitation,
    ListCircle,
    ListLinks,
    ApproveLink,
    BreakLink,
    BlockProfile,
    UnblockProfile,
    ListBlocks,
    CreateWard,
    SetupWardAccount,
    ListWards,
    GetWard,
    RevokeWardSessions,
    ResetWardPassword,
    CreateWardProfile,
    RequestWardRelease,
    AttestAgeForRelease,
    GuardianNotices,
    SetOwnEmail,
    ClearOwnEmail,
    VerifyProfileEmail,
    ListProfileProposals,
    DecideProfileProposal,
    InspectProfileInvitation,
    AcceptProfileInvitation,
    { provide: WardRepository, useClass: PrismaWardRepository },
    { provide: LinkRepository, useClass: PrismaLinkRepository },
    { provide: CircleReader, useExisting: LinkRepository },
    { provide: ProfileRepository, useClass: PrismaProfileRepository },
    { provide: SessionStore, useClass: RedisSessionStore },
    { provide: SecretTokens, useClass: CryptoSecretTokens },
    { provide: CsrfTokens, useClass: HmacCsrfTokens },
    { provide: RateLimiter, useClass: RedisRateLimiter },
    { provide: EventThrottle, useClass: RedisEventThrottle },
    { provide: SecurityLog, useClass: PrismaSecurityLog },
    { provide: MailSender, useClass: SmtpMailSender },
    { provide: ProfileLockPolicies, useClass: PrismaProfileLockPolicies },
    { provide: IdentityEvents, useClass: InProcessIdentityEvents },
    { provide: AccountRepository, useClass: PrismaAccountRepository },
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    { provide: PasswordBreachChecker, useClass: HibpBreachChecker },
    { provide: BackgroundTasks, useClass: InProcessBackgroundTasks },
    { provide: IdentitySettings, useClass: EnvIdentitySettings },
    { provide: SecondFactorRepository, useClass: PrismaSecondFactorRepository },
    { provide: TrustedDeviceRepository, useClass: PrismaTrustedDeviceRepository },
    { provide: PendingSecondFactors, useClass: RedisPendingSecondFactors },
    { provide: SecretCipher, useClass: AesGcmSecretCipher },
    { provide: TotpEngine, useClass: OtplibTotpEngine },
    { provide: GoogleOidc, useClass: OpenIdGoogleOidc },
    { provide: OidcFlows, useClass: RedisOidcFlows },
    { provide: GoogleReauthProofs, useClass: RedisGoogleReauthProofs },
    { provide: GoogleIdentityRepository, useClass: PrismaGoogleIdentityRepository },
    // Refus par défaut sur toutes les routes de l'application (SEC-01).
    { provide: APP_GUARD, useClass: IdentityGuardChain },
  ],
  // Surface pour les autres modules : vérification d'accès et événements (pas le magasin).
  exports: [CheckSessionAccess, IdentityEvents, CircleReader],
})
export class IdentityModule {}
