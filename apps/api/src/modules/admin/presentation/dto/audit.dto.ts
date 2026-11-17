import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AUDIT_ACTIONS, type AuditAction } from '../../../../shared/domain';

/** `GET /admin/audit` (AUD-06). */
export class AuditQueryDto {
  @IsOptional()
  @IsUUID()
  @ApiProperty({ required: false, format: 'uuid' })
  actorAccountId?: string;

  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  @ApiProperty({ required: false, enum: AUDIT_ACTIONS, enumName: 'AuditAction' })
  action?: AuditAction;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @ApiProperty({ required: false, type: String, format: 'date-time' })
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @ApiProperty({ required: false, type: String, format: 'date-time' })
  to?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiProperty({ required: false, maxLength: 200 })
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @ApiProperty({ required: false, minimum: 1, maximum: 50, default: 50 })
  limit?: number;
}
