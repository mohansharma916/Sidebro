import { Module } from '@nestjs/common';
import { SpeechService } from './speech.service.js';
import { SpeechController } from './speech.controller.js';

@Module({
  controllers: [SpeechController],
  providers: [SpeechService],
  exports: [SpeechService],
})
export class SpeechModule {}
