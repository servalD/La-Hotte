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
 * comptes par mot de passe.
 */
@Module({
  controllers: [SessionController, SessionsController, AuthController],
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
    // Refus par défaut sur toutes les routes de l'application (SEC-01).
    { provide: APP_GUARD, useClass: IdentityGuardChain },
  ],
  // Surface pour les autres modules : vérification d'accès et événements (pas le magasin).
  exports: [CheckSessionAccess, IdentityEvents],
})
export class IdentityModule {}
