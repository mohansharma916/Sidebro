import { Controller, Get } from '@nestjs/common';
import { SpeechService } from './speech.service.js';

@Controller('api/speech')
export class SpeechController {
  constructor(private readonly speechService: SpeechService) {}

  @Get('status')
  getStatus() {
    return {
      success: true,
      status: this.speechService.getStatus(),
    };
  }
}
