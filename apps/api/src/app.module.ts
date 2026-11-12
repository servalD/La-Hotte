import { Module } from '@nestjs/common';
import { ExampleModule } from './modules/example';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [PlatformModule, ExampleModule],
})
export class AppModule {}
