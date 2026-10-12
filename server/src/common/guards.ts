import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import crypto from 'crypto';
import type { Request } from 'express';
import { SessionService } from '../session/session.service.js';

export const SESSION_TOKEN_HEADER = 'x-session-token';
export const ADMIN_TOKEN_HEADER = 'x-admin-token';

/**
 * Requires the per-session token (header `x-session-token` or `?token=` for download links)
 * for any route with an `:id` session parameter.
 */
@Injectable()
export class SessionTokenGuard implements CanActivate {
  constructor(private readonly sessionService: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const rawId = req.params?.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const header = req.headers[SESSION_TOKEN_HEADER];
    const token = (Array.isArray(header) ? header[0] : header) || (typeof req.query?.token === 'string' ? req.query.token : undefined);
    if (!id || !this.sessionService.verifyToken(id, token)) {
      // Same response for "no such session" and "wrong token" so ids can't be probed.
      throw new UnauthorizedException('Missing or invalid session token');
    }
    return true;
  }
}

/**
 * Cross-session endpoints (listing all sessions, archive search) need ADMIN_TOKEN.
 * They are disabled entirely when ADMIN_TOKEN is not configured.
 */
@Injectable()
export class AdminTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected) {
      throw new ForbiddenException('This endpoint is disabled. Set ADMIN_TOKEN on the server to enable it.');
    }
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers[ADMIN_TOKEN_HEADER];
    const given = Buffer.from((Array.isArray(header) ? header[0] : header) || '');
    const want = Buffer.from(expected);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
      throw new UnauthorizedException('Missing or invalid admin token');
    }
    return true;
  }
}
