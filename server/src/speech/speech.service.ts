import { Injectable } from '@nestjs/common';
import { SpeechEngine, TranscriptionResult } from '../speechEngine.js';

@Injectable()
export class SpeechService extends SpeechEngine {
  constructor() {
    super();
  }
}

export type { TranscriptionResult };
