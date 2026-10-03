import { Module } from '@nestjs/common';
import { ContextService } from './context.service.js';
import { ContextController } from './context.controller.js';

@Module({
  controllers: [ContextController],
  providers: [ContextService],
  exports: [ContextService],
})
export class ContextModule {}
