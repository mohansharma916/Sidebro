import { Controller, Get, Post, Delete, Body, Param, BadRequestException } from '@nestjs/common';
import { ContextService } from './context.service.js';
import { ContextProfile } from '../types.js';
import { sanitizeProfile } from '../common/validation.js';

@Controller('api/profiles')
export class ContextController {
  constructor(private readonly contextService: ContextService) {}

  @Get()
  getAllProfiles(): ContextProfile[] {
    return this.contextService.getAllProfiles();
  }

  @Post()
  saveProfile(@Body() body: unknown) {
    const profile = sanitizeProfile(body);
    if (!profile) throw new BadRequestException('Invalid profile: an id (letters, digits, - _ . :) is required');
    this.contextService.saveProfile(profile);
    return { success: true, profile };
  }

  @Delete(':id')
  deleteProfile(@Param('id') id: string) {
    this.contextService.deleteProfile(id);
    return { success: true };
  }
}
