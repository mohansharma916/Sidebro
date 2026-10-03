import { Module } from '@nestjs/common';
import { SessionController } from './session.controller.js';
import { SessionService } from './session.service.js';
import { SessionGateway } from './session.gateway.js';
import { QuestionDetectorService } from './question-detector.service.js';
import { MockInterviewerService } from './mock-interviewer.service.js';
import { ContextModule } from '../context/context.module.js';
import { SpeechModule } from '../speech/speech.module.js';
import { AiModule } from '../ai/ai.module.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [ContextModule, SpeechModule, AiModule, StorageModule],
  controllers: [SessionController],
  providers: [
    SessionService,
    QuestionDetectorService,
    MockInterviewerService,
    SessionGateway,
  ],
  exports: [SessionService, SessionGateway],
})
export class SessionModule {}
