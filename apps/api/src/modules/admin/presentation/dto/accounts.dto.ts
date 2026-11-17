import { ApiProperty } from '@nestjs/swagger';
import { Allow, IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { PLATFORM_SETTING_KEYS, type PlatformSettingKey } from '../../../../shared/domain';

/** ADM-10 : adresse exacte. */
export class AccountSearchQueryDto {
  @IsEmail()
  @MaxLength(254)
  @ApiProperty({ format: 'email', maxLength: 254 })
  email!: string;
}

/** RBAC-06 : motif saisi pour toute action sensible. */
export class AdminReasonDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  @ApiProperty({ minLength: 10, maxLength: 500 })
  reason!: string;
}

export const ASSIGNABLE_ROLES = ['USER', 'MODERATOR', 'ADMIN'] as const;

/** RBAC-03, RBAC-07. */
export class ChangeRoleDto extends AdminReasonDto {
  @IsIn(ASSIGNABLE_ROLES)
  @ApiProperty({ enum: ASSIGNABLE_ROLES, enumName: 'AccountRole' })
  role!: (typeof ASSIGNABLE_ROLES)[number];
}

export class SettingKeyParams {
  @IsIn(PLATFORM_SETTING_KEYS)
  @ApiProperty({ enum: PLATFORM_SETTING_KEYS, enumName: 'PlatformSettingKey' })
  key!: PlatformSettingKey;
}

/** ADM-09 : la valeur est validée par le domaine, selon la clé. `null` rend la valeur par défaut. */
export class UpdateSettingDto extends AdminReasonDto {
  @Allow()
  @ApiProperty({
    nullable: true,
    oneOf: [
      { type: 'string', enum: ['OPEN', 'INVITE_ONLY'] },
      { type: 'integer', minimum: 0, maximum: 1000 },
      { type: 'array', items: { type: 'string' }, maxItems: 500 },
    ],
  })
  value!: unknown;
}
