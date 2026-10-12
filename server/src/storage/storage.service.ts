import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import {
  StorageEngine,
  GlobalAnalytics,
  CodingSolutionItem,
  SessionDebugDump,
} from '../storageEngine.js';

@Injectable()
export class StorageService extends StorageEngine implements OnApplicationShutdown {
  constructor() {
    super();
  }

  onApplicationShutdown() {
    this.close();
  }
}

export type { GlobalAnalytics, CodingSolutionItem, SessionDebugDump };
