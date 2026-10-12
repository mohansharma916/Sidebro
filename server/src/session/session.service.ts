import { Injectable, BeforeApplicationShutdown } from '@nestjs/common';
import { SessionManager } from '../sessionManager.js';
import { StorageService } from '../storage/storage.service.js';

@Injectable()
export class SessionService extends SessionManager implements BeforeApplicationShutdown {
  constructor(storageService: StorageService) {
    super(storageService);
  }

  beforeApplicationShutdown() {
    this.shutdown();
  }
}
