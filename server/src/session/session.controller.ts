import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpException,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { SessionService } from './session.service.js';
import { OpResult, SessionGateway } from './session.gateway.js';
import { SpeechService } from '../speech/speech.service.js';
import { MockInterviewerService } from './mock-interviewer.service.js';
import { AdminTokenGuard, SessionTokenGuard } from '../common/guards.js';
import { RateLimiter } from '../common/rate-limiter.js';
import {
  EXPERIENCE_LEVELS,
  QUESTION_CATEGORIES,
  SESSION_TYPES,
  SPEAKERS,
  cleanText,
  oneOf,
  sanitizeDevice,
  sanitizeProfile,
} from '../common/validation.js';
import { SessionState } from '../types.js';

/** Base64 of ~30 s of compressed audio is far below this. */
const MAX_AUDIO_BASE64_CHARS = 4 * 1024 * 1024;

function unwrap<T>(result: OpResult<T>): T {
  if (result.ok) return result.value;
  throw new HttpException(result.message, result.status);
}

/** Session as returned by listing endpoints: never includes the pairing code or token. */
function publicSummary(s: SessionState) {
  const { code: _code, token: _token, profile, ...rest } = s;
  return { ...rest, profileName: profile?.name };
}

@Controller('api/sessions')
export class SessionController {
  private codeLookupLimiter = new RateLimiter(30, 60_000);
  private audioLimiter = new RateLimiter(60, 60_000);

  constructor(
    private readonly sessionService: SessionService,
    private readonly sessionGateway: SessionGateway,
    private readonly speechService: SpeechService,
    private readonly mockInterviewerService: MockInterviewerService
  ) {}

  private withHistory(session: SessionState) {
    return {
      ...session,
      transcripts: this.sessionService.getTranscripts(session.id),
      questions: this.sessionService.getQuestions(session.id),
      answers: this.sessionService.getAnswers(session.id),
      notes: this.sessionService.getNotes(session.id),
      currentQuestion: this.sessionService.getCurrentQuestion(session.id),
    };
  }

  /** Creates a session. The response contains the session token; keep it to access the session later. */
  @Post()
  createSession(@Body() body: Record<string, unknown>) {
    return this.sessionService.createSession(
      oneOf(body?.type, SESSION_TYPES),
      cleanText(body?.title, 200),
      sanitizeProfile(body?.profile),
      oneOf(body?.experienceLevel, EXPERIENCE_LEVELS)
    );
  }

  @Get()
  @UseGuards(AdminTokenGuard)
  getAllSessions() {
    return this.sessionService.getAllSessions().map(publicSummary);
  }

  /** Pairing: the 6-character code is the shared secret, so a valid code returns the session token. */
  @Get('code/:code')
  getSessionByCode(@Param('code') code: string) {
    if (!this.codeLookupLimiter.allow('code-lookup')) {
      throw new HttpException('Too many attempts; try again in a minute', 429);
    }
    const session = this.sessionService.getSessionByCode(code);
    if (!session) {
      throw new NotFoundException('Invalid or expired session code');
    }
    return this.withHistory(session);
  }

  @Get(':id')
  @UseGuards(SessionTokenGuard)
  getSession(@Param('id') id: string) {
    const session = this.sessionService.getSession(id);
    if (!session) throw new NotFoundException('Session not found');
    return this.withHistory(session);
  }

  @Post(':id/devices')
  @UseGuards(SessionTokenGuard)
  addDevice(@Param('id') id: string, @Body() body: unknown) {
    const session = this.sessionService.getSession(id);
    if (!session) throw new NotFoundException('Session not found');
    const device = sanitizeDevice(body);
    if (!device) throw new BadRequestException('Missing or invalid device information');

    this.sessionService.addDevice(session.id, device);
    this.sessionGateway.broadcastToSession(session.id, {
      event: 'device.connected',
      sessionId: session.id,
      payload: device,
    });

    return { success: true, devices: session.devices };
  }

  @Get(':id/devices')
  @UseGuards(SessionTokenGuard)
  getDevices(@Param('id') id: string) {
    return this.sessionService.getSession(id)?.devices || [];
  }

  @Get(':id/summary')
  @UseGuards(SessionTokenGuard)
  getSummary(@Param('id') id: string) {
    const summary = this.sessionService.generateSummary(id);
    if (!summary) throw new NotFoundException('Summary not available');
    return summary;
  }

  @Post(':id/pause')
  @UseGuards(SessionTokenGuard)
  pauseSession(@Param('id') id: string) {
    const session = this.sessionGateway.pause(id);
    if (!session) throw new NotFoundException('Session not found');
    return { success: true, session };
  }

  @Post(':id/resume')
  @UseGuards(SessionTokenGuard)
  resumeSession(@Param('id') id: string) {
    const session = this.sessionGateway.resume(id);
    if (!session) throw new NotFoundException('Session not found');
    return { success: true, session };
  }

  @Post(':id/end')
  @UseGuards(SessionTokenGuard)
  endSession(@Param('id') id: string) {
    const result = this.sessionGateway.end(id);
    if (!result) throw new NotFoundException('Session not found');
    return { success: true, ...result };
  }

  @Delete(':id')
  @UseGuards(SessionTokenGuard)
  deleteSession(@Param('id') id: string) {
    this.sessionGateway.end(id);
    if (!this.sessionService.deleteSession(id)) throw new NotFoundException('Session not found');
    return { success: true, message: 'Session permanently deleted.' };
  }

  @Get(':id/transcripts')
  @UseGuards(SessionTokenGuard)
  getTranscripts(@Param('id') id: string) {
    return this.sessionService.getTranscripts(id);
  }

  /**
   * Ingests a final transcript. Send the same `clientId` when retrying so the utterance is stored once.
   */
  @Post(':id/transcripts')
  @UseGuards(SessionTokenGuard)
  ingestTranscript(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const transcript = unwrap(this.sessionGateway.ingestTranscript(id, body || {}));
    return { success: true, transcript, duplicate: transcript === null };
  }

  @Post(':id/transcribe-audio')
  @UseGuards(SessionTokenGuard)
  async transcribeAudio(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const session = this.sessionService.getSession(id);
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== 'active') {
      return { success: true, text: '', message: `Session is ${session.status}, audio ignored` };
    }
    if (!this.audioLimiter.allow(id)) {
      throw new HttpException('Too many audio slices', 429);
    }

    const audioBase64 = body?.audioBase64;
    if (typeof audioBase64 !== 'string' || !audioBase64) {
      throw new BadRequestException('audioBase64 is required');
    }
    if (audioBase64.length > MAX_AUDIO_BASE64_CHARS) {
      throw new BadRequestException('Audio slice too large');
    }
    const mimeType = typeof body.mimeType === 'string' && /^audio\/[\w.+-]+(;.*)?$/.test(body.mimeType) ? body.mimeType : 'audio/webm';
    const speaker = oneOf(body.speaker, SPEAKERS) || 'OTHER';

    let result;
    try {
      result = await this.speechService.transcribeAudio(Buffer.from(audioBase64, 'base64'), mimeType);
    } catch (err: any) {
      throw new ServiceUnavailableException(err?.message || 'Transcription error');
    }

    if (!result.text) {
      return { success: true, text: '', message: 'No speech detected in audio slice' };
    }
    const transcript = unwrap(this.sessionGateway.ingestTranscript(id, { speaker, text: result.text, confidence: result.confidence }));
    return { success: true, text: result.text, transcript, engine: result.engine };
  }

  @Post(':id/ask')
  @UseGuards(SessionTokenGuard)
  askQuestion(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const question = unwrap(
      this.sessionGateway.askQuestion(id, body?.questionText, oneOf(body?.category, QUESTION_CATEGORIES))
    );
    return { success: true, question };
  }

  @Post(':id/action')
  @UseGuards(SessionTokenGuard)
  triggerAction(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    unwrap(this.sessionGateway.regenerate(id, body?.questionId, body?.modifier));
    return { success: true };
  }

  @Post(':id/notes')
  @UseGuards(SessionTokenGuard)
  addNote(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const note = unwrap(this.sessionGateway.addNote(id, body?.text, body?.questionId));
    return { success: true, note };
  }

  @Post(':id/mock-interview/start')
  @UseGuards(SessionTokenGuard)
  startMockInterview(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const scenarioId = unwrap(this.sessionGateway.startMock(id, body?.scenarioId));
    return { success: true, scenarioId };
  }

  @Post(':id/mock-interview/stop')
  @UseGuards(SessionTokenGuard)
  stopMockInterview(@Param('id') id: string) {
    this.sessionGateway.stopMock(id);
    return { success: true };
  }

  @Get(':id/mock-interview/status')
  @UseGuards(SessionTokenGuard)
  getMockInterviewStatus(@Param('id') id: string) {
    return {
      running: this.mockInterviewerService.isRunning(id),
      scenarios: this.mockInterviewerService.getScenarios(),
    };
  }
}
