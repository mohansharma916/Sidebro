import { Injectable } from '@nestjs/common';
import {
  StorageEngine,
  GlobalAnalytics,
  CodingSolutionItem,
  SessionDebugDump,
} from '../storageEngine.js';
import {
  SessionState,
  TranscriptItem,
  DetectedQuestion,
  GeneratedAnswer,
  SessionNote,
  PostSessionSummary,
} from '../types.js';

@Injectable()
export class StorageService extends StorageEngine {
  constructor() {
    super();
  }
}

export type { GlobalAnalytics, CodingSolutionItem, SessionDebugDump };
