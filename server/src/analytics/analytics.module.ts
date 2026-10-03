import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [StorageModule],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
