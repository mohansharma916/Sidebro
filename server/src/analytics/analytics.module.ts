import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { StorageModule } from '../storage/storage.module.js';
import { SessionModule } from '../session/session.module.js';

@Module({
  imports: [StorageModule, SessionModule],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
