import { Controller, Get, Post, Body } from '@nestjs/common';
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

  @Post('config')
  setConfig(@Body() body: { provider: 'groq' | 'openai'; apiKey: string }) {
    if (body.provider && body.apiKey) {
      this.speechService.setApiKey(body.provider, body.apiKey);
    }
    return { success: true, status: this.speechService.getStatus() };
  }
}
