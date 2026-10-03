import { Injectable } from '@nestjs/common';
import { ContextEngine, DocumentChunk } from '../contextEngine.js';
import { ContextProfile } from '../types.js';

@Injectable()
export class ContextService extends ContextEngine {
  constructor() {
    super();
  }
}

export type { DocumentChunk };
