import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity';
import {
  ListAdminActionsOnAccount,
  ReadSettings,
  SearchAccount,
  UpdateSetting,
} from './application/administer-platform.use-case';
import { ReadAudit } from './application/read-audit.use-case';
import { AccountDirectory, AccountSearchQuota } from './domain/account-directory';
import { AuditTrail } from './domain/audit-trail';
import { RedisAccountSearchQuota } from './infrastructure/account-search-quota';
import { PrismaAccountDirectory } from './infrastructure/prisma-account-directory';
import { PrismaAuditTrail } from './infrastructure/prisma-audit-trail';
import {
  AccountAdminActionsController,
  AdminAccountsController,
  AdminSettingsController,
} from './presentation/admin-accounts.controller';
import { AdminAuditController } from './presentation/admin-audit.controller';

/**
 * Module `admin` (spec `11`, ADR 0021) : espace d'administration hors de tout profil. Aucune route
 * ne renvoie un contenu d'utilisateur (ADM-01) ; chaque action écrit son entrée d'audit dans sa
 * transaction (AUD-05).
 */
@Module({
  imports: [IdentityModule],
  controllers: [
    AdminAuditController,
    AdminAccountsController,
    AdminSettingsController,
    AccountAdminActionsController,
  ],
  providers: [
    ReadAudit,
    SearchAccount,
    ReadSettings,
    UpdateSetting,
    ListAdminActionsOnAccount,
    { provide: AuditTrail, useClass: PrismaAuditTrail },
    { provide: AccountDirectory, useClass: PrismaAccountDirectory },
    { provide: AccountSearchQuota, useClass: RedisAccountSearchQuota },
  ],
})
export class AdminModule {}
