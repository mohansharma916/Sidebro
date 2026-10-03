import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { SessionManager } from '../sessionManager.js';
import { StorageService } from '../storage/storage.service.js';
import {
  AnswerLengthMode,
  ContextProfile,
  DetectedQuestion,
  DeviceInfo,
  ExperienceLevel,
  GeneratedAnswer,
  PostSessionSummary,
  SessionNote,
  SessionState,
  SessionType,
  TranscriptItem,
} from '../types.js';

@Injectable()
export class SessionService extends SessionManager implements OnModuleDestroy {
  constructor(private readonly storageService: StorageService) {
    super();
    // Connect to injected global storage service
    (this as any).storage = storageService;
    (this as any).loadFromStorage();
  }

  onModuleDestroy() {
    // Clean up any running session duration intervals
    for (const [id] of (this as any).sessions) {
      this.pauseSession(id);
    }
  }
}
