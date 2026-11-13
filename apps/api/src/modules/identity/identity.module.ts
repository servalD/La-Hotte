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
  exports: [CheckSessionAccess, IdentityEvents],
})
export class IdentityModule {}
