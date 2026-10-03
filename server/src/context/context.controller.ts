import { Controller, Get, Post, Delete, Body, Param } from '@nestjs/common';
import { ContextService } from './context.service.js';
import { ContextProfile } from '../types.js';

@Controller('api/profiles')
export class ContextController {
  constructor(private readonly contextService: ContextService) {}

  @Get()
  getAllProfiles(): ContextProfile[] {
    return this.contextService.getAllProfiles();
  }

  @Post()
  saveProfile(@Body() profile: ContextProfile) {
    this.contextService.saveProfile(profile);
    return { success: true, profile };
  }

  @Delete(':id')
  deleteProfile(@Param('id') id: string) {
    this.contextService.deleteProfile(id);
    return { success: true };
  }
}
