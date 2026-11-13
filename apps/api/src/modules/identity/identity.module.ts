import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthorizeProfile } from './application/authorize-profile.use-case';
import { CheckSessionAccess } from './application/check-session-access.use-case';
import { ReportCsrfRejection } from './application/report-csrf-rejection.use-case';
import { ResolveSession } from './application/resolve-session.use-case';
import { SessionLifecycle } from './application/session-lifecycle';
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
import { CryptoSecretTokens, HmacCsrfTokens } from './infrastructure/crypto-tokens';
import { RedisEventThrottle, RedisRateLimiter } from './infrastructure/redis-rate-limiter';
import { RedisSessionStore } from './infrastructure/redis-session-store';
import { IdentityGuardChain } from './presentation/guard-chain.guard';
import { SessionController } from './presentation/session.controller';

/** Module `identity` (ADR 0011, ADR 0013) : sessions, gardes, limitation, journal de sécurité. */
@Module({
  controllers: [SessionController],
  providers: [
    ResolveSession,
    AuthorizeProfile,
    CheckSessionAccess,
    SessionLifecycle,
    ReportCsrfRejection,
    { provide: SessionStore, useClass: RedisSessionStore },
    { provide: SecretTokens, useClass: CryptoSecretTokens },
    { provide: CsrfTokens, useClass: HmacCsrfTokens },
    { provide: RateLimiter, useClass: RedisRateLimiter },
    { provide: EventThrottle, useClass: RedisEventThrottle },
    { provide: SecurityLog, useClass: PrismaSecurityLog },
    { provide: MailSender, useClass: SmtpMailSender },
    { provide: ProfileLockPolicies, useClass: PrismaProfileLockPolicies },
    { provide: IdentityEvents, useClass: InProcessIdentityEvents },
    // Refus par défaut sur toutes les routes de l'application (SEC-01).
    { provide: APP_GUARD, useClass: IdentityGuardChain },
  ],
  // Surface pour les autres modules : vérification d'accès et événements (pas le magasin).
  exports: [CheckSessionAccess, IdentityEvents],
})
export class IdentityModule {}
