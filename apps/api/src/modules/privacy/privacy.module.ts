import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting';
import { CatalogModule } from '../catalog';
import { ConversationsModule } from '../conversations';
import { IdentityModule } from '../identity';
import { ListsModule } from '../lists';
import {
  DownloadProfileData,
  ExportProfileData,
  PurgeProfileExports,
} from './application/export-profile-data.use-case';
import { DataExportStore } from './domain/data-export';
import { PrismaDataExportStore } from './infrastructure/data-export-store';
import { DataExportController } from './presentation/data-export.controller';
import { ExportPurgeScheduler } from './presentation/export-purge.scheduler';

/**
 * Module `privacy` (RGPD-04, RGPD-11, ADR 0021) : export des données d'un profil, composé des
 * lectures des autres modules, au nom du profil.
 */
@Module({
  imports: [IdentityModule, ListsModule, AccountingModule, CatalogModule, ConversationsModule],
  controllers: [DataExportController],
  providers: [
    ExportProfileData,
    DownloadProfileData,
    PurgeProfileExports,
    ExportPurgeScheduler,
    { provide: DataExportStore, useClass: PrismaDataExportStore },
  ],
})
export class PrivacyModule {}
