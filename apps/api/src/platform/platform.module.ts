import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Clock, IdGenerator } from '../shared/domain';
import { AppConfig, parseEnv } from './config/env';
import { HealthController } from './health/health.controller';
import { ProblemDetailsFilter } from './http/problem-details.filter';
import { createValidationPipe } from './http/validation';
import { SystemClock, UuidV7IdGenerator } from './ids/system.providers';
import { LoggingModule } from './logging/logging.module';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

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
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
  exports: [PrismaService, RedisService, IdGenerator, Clock],
})
export class PlatformModule {}
