import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  ActiveProfile,
  type ActiveProfileValue,
  CurrentSession,
  RequiresProfile,
} from '../../identity';
import { ManagePushSubscriptions } from '../application/contract';

class PushKeysDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{80,100}$/)
  p256dh!: string;

  @ApiProperty({ maxLength: 32 })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{16,32}$/)
  auth!: string;
}

/** NOT-15, NOT-16 */
export class PushSubscriptionDto {
  @ApiProperty({ maxLength: 1024, format: 'uri' })
  @IsString()
  @MaxLength(1024)
  @Matches(/^https:\/\//)
  endpoint!: string;

  @ApiProperty({ type: PushKeysDto })
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;

  /** NOT-06 : désactivé par défaut. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showDetails?: boolean;
}

export class PushEndpointDto {
  @ApiProperty({ maxLength: 1024, format: 'uri' })
  @IsString()
  @MaxLength(1024)
  @Matches(/^https:\/\//)
  endpoint!: string;
}

export class PushDetailsDto extends PushEndpointDto {
  @ApiProperty()
  @IsBoolean()
  showDetails!: boolean;
}

export class PushKeyView {
  /** Clé VAPID publique ; absente si les push ne sont pas configurées. */
  @ApiProperty({ type: String, nullable: true }) publicKey!: string | null;
}

type SessionValue = { readonly record: { readonly id: string } } | null;

function sessionIdOf(session: SessionValue): string {
  // `@RequiresProfile()` garantit la session ; seconde barrière.
  if (!session) throw new Error('Session absente');
  return session.record.id;
}

/** Abonnements push de l'appareil, pour le profil actif (NOT-15, NOT-16). */
@ApiTags('notifications')
@RequiresProfile()
@Controller('push-subscriptions')
export class PushController {
  constructor(private readonly push: ManagePushSubscriptions) {}

  @Get('key')
  @ApiOkResponse({ type: PushKeyView })
  getPushKey(): PushKeyView {
    return { publicKey: this.push.publicKey() };
  }

  @Post()
  @HttpCode(204)
  @ApiNoContentResponse()
  async subscribePush(
    @Body() body: PushSubscriptionDto,
    @CurrentSession() session: SessionValue,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.push.register({
      sessionId: sessionIdOf(session),
      profileId: profile.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      showDetails: body.showDetails ?? false,
    });
  }

  @Post('remove')
  @HttpCode(204)
  @ApiNoContentResponse()
  async unsubscribePush(
    @Body() body: PushEndpointDto,
    @CurrentSession() session: SessionValue,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.push.unregister({
      sessionId: sessionIdOf(session),
      profileId: profile.id,
      endpoint: body.endpoint,
    });
  }

  @Put('details')
  @HttpCode(204)
  @ApiNoContentResponse()
  async setPushDetails(
    @Body() body: PushDetailsDto,
    @CurrentSession() session: SessionValue,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.push.setDetails({
      sessionId: sessionIdOf(session),
      profileId: profile.id,
      endpoint: body.endpoint,
      showDetails: body.showDetails,
    });
  }
}
