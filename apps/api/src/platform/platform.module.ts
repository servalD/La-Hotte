import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import {
  AppEvents,
  AuditJournal,
  Clock,
  IdGenerator,
  Metrics,
  PlatformSettings,
} from '../shared/domain';
import { InProcessAppEvents } from './events/in-process-app-events';
import { AppConfig, parseEnv } from './config/env';
import { HealthController } from './health/health.controller';
import {
  IdempotencyInterceptor,
  IdempotencyStore,
  PrismaIdempotencyStore,
} from './http/idempotency';
import { IdempotencyPurgeScheduler } from './http/idempotency.scheduler';
import { ProblemDetailsFilter } from './http/problem-details.filter';
import { createValidationPipe } from './http/validation';
import { SystemClock, UuidV7IdGenerator } from './ids/system.providers';
import { LoggingModule } from './logging/logging.module';
import { PrismaAuditJournal } from './prisma/prisma-audit-journal';
import { PrismaService } from './prisma/prisma.service';
import { PrismaPlatformSettings } from './settings/prisma-platform-settings';
import { RedisService } from './redis/redis.service';
import { ErrorReporter, SentryErrorReporter, TelemetryShutdown } from './telemetry/error-reporter';
import { OtelMetrics } from './telemetry/otel-metrics';

@Global()
@Module({
  providers: [
    { provide: AppConfig, useFactory: (): AppConfig => ({ env: parseEnv(process.env) }) },
  ],
  exports: [AppConfig],
})
class ConfigModule {}

/** Services techniques partagés par tous les modules métier. */
@Global()
@Module({
  imports: [ConfigModule, LoggingModule],
  controllers: [HealthController],
  providers: [
    PrismaService,
    RedisService,
    { provide: IdGenerator, useClass: UuidV7IdGenerator },
    { provide: Clock, useClass: SystemClock },
    { provide: Metrics, useClass: OtelMetrics },
    { provide: ErrorReporter, useClass: SentryErrorReporter },
    InProcessAppEvents,
    { provide: AppEvents, useExisting: InProcessAppEvents },
    TelemetryShutdown,
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: IdempotencyStore, useClass: PrismaIdempotencyStore },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    IdempotencyPurgeScheduler,
    { provide: AuditJournal, useClass: PrismaAuditJournal },
    { provide: PlatformSettings, useClass: PrismaPlatformSettings },
  ],
  exports: [
    AuditJournal,
    PlatformSettings,
    IdempotencyStore,
    PrismaService,
    RedisService,
    IdGenerator,
    Clock,
    Metrics,
    ErrorReporter,
    AppEvents,
    InProcessAppEvents,
  ],
})
export class PlatformModule {}
