import { Module } from '@nestjs/common';
import { ExampleModule } from './modules/example';
import { IdentityModule } from './modules/identity';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [PlatformModule, IdentityModule, ExampleModule],
})
export class AppModule {}
