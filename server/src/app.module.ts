import { Module } from '@nestjs/common';
import { StorageModule } from './storage/storage.module.js';
import { NetworkModule } from './network/network.module.js';
import { ContextModule } from './context/context.module.js';
import { SpeechModule } from './speech/speech.module.js';
import { AiModule } from './ai/ai.module.js';
import { SessionModule } from './session/session.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';

@Module({
  imports: [
    StorageModule,
    NetworkModule,
    ContextModule,
    SpeechModule,
    AiModule,
    SessionModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
