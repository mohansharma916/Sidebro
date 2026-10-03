import { Injectable } from '@nestjs/common';
import { AIEngine, AnswerStreamCallbacks } from '../aiEngine.js';

@Injectable()
export class AiService extends AIEngine {
  constructor() {
    super();
  }
}

export type { AnswerStreamCallbacks };
