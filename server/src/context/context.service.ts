import { Injectable } from '@nestjs/common';
import { ContextEngine, DocumentChunk } from '../contextEngine.js';
import { StorageService } from '../storage/storage.service.js';

@Injectable()
export class ContextService extends ContextEngine {
  constructor(storageService: StorageService) {
    super(storageService);
  }
}

export type { DocumentChunk };
