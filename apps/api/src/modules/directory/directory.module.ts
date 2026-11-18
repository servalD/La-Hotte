import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { ListsModule } from '../lists';
import { VisibilityModule } from '../visibility';
import {
  CopyFromDirectory,
  DirectoryEntryReader,
  SearchDirectory,
  SearchGlobalCatalog,
  ShareProduct,
} from './application/directory.use-cases';
import { DirectoryController, ProductShareController } from './presentation/directory.controller';

/** Module `directory` : répertoire du cercle et partage des fiches (04, REP-01 à REP-10). */
@Module({
  imports: [VisibilityModule, CatalogModule, ListsModule],
  controllers: [ProductShareController, DirectoryController],
  providers: [
    ShareProduct,
    SearchDirectory,
    SearchGlobalCatalog,
    CopyFromDirectory,
    DirectoryEntryReader,
  ],
  exports: [DirectoryEntryReader],
})
export class DirectoryModule {}
