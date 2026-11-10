import { Global, Module } from '@nestjs/common';
import { CronManagementController } from './cron-management.controller';
import { CronRegistryService } from './cron-registry.service';

@Global()
@Module({
  controllers: [CronManagementController],
  providers: [CronRegistryService],
  exports: [CronRegistryService],
})
export class CronManagementModule {}
