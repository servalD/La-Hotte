import { Module } from '@nestjs/common';
import { CatalogModule } from './modules/catalog';
import { DirectoryModule } from './modules/directory';
import { IdentityModule } from './modules/identity';
import { ListsModule } from './modules/lists';
import { VisibilityModule } from './modules/visibility';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [
    PlatformModule,
    IdentityModule,
    VisibilityModule,
    CatalogModule,
    ListsModule,
    DirectoryModule,
  ],
})
export class AppModule {}
