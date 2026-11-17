import { ApiProperty } from '@nestjs/swagger';
import { AUDIT_ACTIONS, type AuditAction } from '../../../../shared/domain';

export class SuspensionEventView {
  @ApiProperty({ enum: AUDIT_ACTIONS, enumName: 'AuditAction' }) action!: AuditAction;
  @ApiProperty({ type: String, format: 'date-time' }) at!: string;
}

/** ADM-04 : métadonnées seulement. Ni adresse, ni nom, ni titre (ADM-01). */
export class AccountMetadataView {
  @ApiProperty({ format: 'uuid' }) accountId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastSignInAt!: string | null;
  @ApiProperty() profileCount!: number;
  @ApiProperty() listCount!: number;
  @ApiProperty({ enum: ['USER', 'MODERATOR', 'ADMIN'], enumName: 'AccountRole' })
  role!: 'USER' | 'MODERATOR' | 'ADMIN';
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'PENDING_DELETION'], enumName: 'AccountStatus' })
  status!: 'ACTIVE' | 'SUSPENDED' | 'PENDING_DELETION';
  @ApiProperty() totpEnabled!: boolean;
  @ApiProperty() emailVerified!: boolean;
  @ApiProperty() publicationSuspended!: boolean;
  @ApiProperty({ type: [SuspensionEventView] }) suspensions!: SuspensionEventView[];
}

export class AccountSearchView {
  @ApiProperty({ type: AccountMetadataView, nullable: true }) account!: AccountMetadataView | null;
}

/** ADM-09 : valeurs courantes ; `null` = valeur par défaut. */
export class PlatformSettingsView {
  @ApiProperty({ enum: ['OPEN', 'INVITE_ONLY'], enumName: 'RegistrationMode', nullable: true })
  registration_mode!: 'OPEN' | 'INVITE_ONLY' | null;
  @ApiProperty({ type: [String] }) forbidden_terms!: string[];
  @ApiProperty({ type: [String] }) blocked_domains!: string[];
  @ApiProperty({ type: Number, nullable: true }) extraction_daily_limit!: number | null;
}

/** AUD-07 : sans acteur ni adresse IP. */
export class AdminActionOnAccountView {
  @ApiProperty({ enum: AUDIT_ACTIONS, enumName: 'AuditAction' }) action!: AuditAction;
  @ApiProperty({ type: String, format: 'date-time' }) at!: string;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
}

export class AdminActionsOnAccountView {
  @ApiProperty({ type: [AdminActionOnAccountView] }) items!: AdminActionOnAccountView[];
}
