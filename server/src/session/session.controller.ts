import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SessionService } from './session.service.js';
import { SessionGateway } from './session.gateway.js';
import { SpeechService } from '../speech/speech.service.js';
import { MockInterviewerService } from './mock-interviewer.service.js';
import { QuestionDetectorService } from './question-detector.service.js';
import {
  ContextProfile,
  DetectedQuestion,
  DeviceInfo,
  ExperienceLevel,
  SessionNote,
  SessionType,
  TranscriptItem,
} from '../types.js';

@Controller('api/sessions')
export class SessionController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly sessionGateway: SessionGateway,
    private readonly speechService: SpeechService,
    private readonly mockInterviewerService: MockInterviewerService,
    private readonly questionDetectorService: QuestionDetectorService
  ) {}

  @Post()
  createSession(
    @Body()
    body: {
      type?: SessionType;
      title?: string;
      profile?: ContextProfile;
      experienceLevel?: ExperienceLevel;
    }
  ) {
    const { type, title, profile, experienceLevel } = body;
    const session = this.sessionService.createSession(type, title, profile, experienceLevel);
    return session;
  }

  @Get()
  getAllSessions() {
    return this.sessionService.getAllSessions();
  }

  @Get('code/:code')
  getSessionByCode(@Param('code') code: string) {
    const session = this.sessionService.getSessionByCode(code);
    if (!session) {
      throw new NotFoundException('Invalid or expired session code');
    }
    return {
      ...session,
      transcripts: this.sessionService.getTranscripts(session.id),
      questions: this.sessionService.getQuestions(session.id),
      answers: this.sessionService.getAnswers(session.id),
      notes: this.sessionService.getNotes(session.id),
      currentQuestion: this.sessionService.getCurrentQuestion(session.id),
    };
  }

  @Get(':id')
  getSession(@Param('id') id: string) {
    const session = this.sessionService.getSession(id);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return {
      ...session,
      transcripts: this.sessionService.getTranscripts(session.id),
      questions: this.sessionService.getQuestions(session.id),
      answers: this.sessionService.getAnswers(session.id),
      notes: this.sessionService.getNotes(session.id),
      currentQuestion: this.sessionService.getCurrentQuestion(session.id),
    };
  }

  @Post(':id/devices')
  addDevice(@Param('id') id: string, @Body() device: DeviceInfo) {
    const session = this.sessionService.getSession(id);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    if (!device || !device.id) {
      throw new BadRequestException('Missing device information');
    }

    this.sessionService.addDevice(session.id, device);

    // Broadcast device connection to all active session clients (Desktop Agent + others)
    this.sessionGateway.broadcastToSession(session.id, {
      event: 'device.connected',
      sessionId: session.id,
      payload: device,
    });

    return { success: true, session, devices: session.devices };
  }

  @Get(':id/devices')
  getDevices(@Param('id') id: string) {
    const session = this.sessionService.getSession(id);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return session.devices || [];
  }

  @Get(':id/summary')
  getSummary(@Param('id') id: string) {
    const summary = this.sessionService.generateSummary(id);
    if (!summary) {
      throw new NotFoundException('Summary not available');
    }
    return summary;
  }

  @Post(':id/pause')
  pauseSession(@Param('id') id: string) {
    const session = this.sessionService.pauseSession(id);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    this.sessionGateway.broadcastToSession(id, {
      event: 'session.paused',
      sessionId: id,
      payload: { durationSeconds: session.durationSeconds },
    });
    return { success: true, session };
  }

  @Post(':id/resume')
  resumeSession(@Param('id') id: string) {
    const session = this.sessionService.resumeSession(id);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    this.sessionGateway.broadcastToSession(id, {
      event: 'session.resumed',
      sessionId: id,
      payload: { durationSeconds: session.durationSeconds },
    });
    return { success: true, session };
  }

  @Post(':id/end')
  endSession(@Param('id') id: string) {
    const session = this.sessionService.endSession(id);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    this.mockInterviewerService.stopScenario(id);
    this.questionDetectorService.clearSession(id);
    const summary = this.sessionService.generateSummary(id);

    this.sessionGateway.broadcastToSession(id, {
      event: 'session.ended',
      sessionId: id,
      payload: { summary, durationSeconds: session.durationSeconds },
    });
    return { success: true, session, summary };
  }

  @Delete(':id')
  deleteSession(@Param('id') id: string) {
    const success = this.sessionService.deleteSession(id);
    if (!success) {
      throw new NotFoundException('Session not found');
    }
    return { success: true, message: 'Session permanently deleted.' };
  }

  @Get(':id/transcripts')
  getTranscripts(@Param('id') id: string) {
    return this.sessionService.getTranscripts(id);
  }

  @Post(':id/transcripts')
  ingestTranscript(
    @Param('id') id: string,
    @Body()
    body: {
      speaker?: 'YOU' | 'OTHER';
      text: string;
      confidence?: number;
      isFinal?: boolean;
    }
  ) {
    const session = this.sessionService.getSession(id);
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const { speaker, text, confidence, isFinal } = body;
    if (!text || !text.trim()) {
      throw new BadRequestException('Transcript text is required');
    }

    const transcript: TranscriptItem = {
      id: `tr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      sessionId: id,
      speaker: speaker === 'YOU' ? 'YOU' : 'OTHER',
      text: text.trim(),
      isFinal: isFinal ?? true,
      timestamp: Date.now(),
      confidence: confidence ?? 0.95,
    };

    this.sessionGateway.handleTranscriptIngestion(transcript);
    return { success: true, transcript };
  }

  @Post(':id/transcribe-audio')
  async transcribeAudio(
    @Param('id') id: string,
    @Body()
    body: {
      audioBase64: string;
      mimeType?: string;
      speaker?: 'YOU' | 'OTHER';
    }
  ) {
    const session = this.sessionService.getSession(id);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    if (session.status !== 'active') {
      return { success: true, text: '', message: `Session is ${session.status}, audio ignored` };
    }

    const { audioBase64, mimeType = 'audio/webm', speaker = 'OTHER' } = body;
    if (!audioBase64) {
      throw new BadRequestException('audioBase64 is required');
    }

    try {
      const audioBuffer = Buffer.from(audioBase64, 'base64');
      const result = await this.speechService.transcribeAudio(audioBuffer, mimeType);

      if (result.text && result.text.trim()) {
        const transcript: TranscriptItem = {
          id: `tr-audio-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          sessionId: id,
          speaker: speaker === 'YOU' ? 'YOU' : 'OTHER',
          text: result.text.trim(),
          isFinal: true,
          timestamp: Date.now(),
          confidence: result.confidence,
        };

        this.sessionGateway.handleTranscriptIngestion(transcript);
        return { success: true, text: result.text, transcript, engine: result.engine };
      }

      return { success: true, text: '', message: 'No speech detected in audio slice' };
    } catch (err: any) {
      throw new InternalServerErrorException(err.message || 'Transcription error');
    }
  }

  @Post(':id/ask')
  async askQuestion(
    @Param('id') id: string,
    @Body() body: { questionText: string; category?: string }
  ) {
    const session = this.sessionService.getSession(id);
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const { questionText, category } = body;
    if (!questionText || !questionText.trim()) {
      throw new BadRequestException('Question text is required');
    }

    const detected: DetectedQuestion = {
      id: `q-manual-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      sessionId: id,
      questionText: questionText.trim(),
      type: (category as any) || 'technical',
      confidence: 1.0,
      timestamp: Date.now(),
    };

    this.sessionService.addQuestion(detected);
    this.sessionGateway.broadcastToSession(id, {
      event: 'question.detected',
      sessionId: id,
      payload: detected,
    });

    await this.sessionGateway.triggerAnswerGeneration(detected);
    return { success: true, question: detected };
  }

  @Post(':id/action')
  async triggerAction(
    @Param('id') id: string,
    @Body()
    body: {
      questionId: string;
      modifier: 'shorter' | 'expand' | 'example' | 'technical_detail' | 'star' | 'alternative';
    }
  ) {
    const session = this.sessionService.getSession(id);
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const { questionId, modifier } = body;
    const questions = this.sessionService.getQuestions(id);
    const targetQ = questions.find(q => q.id === questionId);
    if (!targetQ) {
      throw new NotFoundException('Question not found');
    }

    await this.sessionGateway.triggerAnswerGeneration(targetQ, modifier);
    return { success: true };
  }

  @Post(':id/notes')
  addNote(@Param('id') id: string, @Body() body: { text: string; questionId?: string }) {
    const session = this.sessionService.getSession(id);
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const { text, questionId } = body;
    if (!text || !text.trim()) {
      throw new BadRequestException('Note text is required');
    }

    const note: SessionNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      sessionId: id,
      questionId,
      text: text.trim(),
      timestamp: Date.now(),
    };

    this.sessionService.addNote(note);
    this.sessionGateway.broadcastToSession(id, {
      event: 'note.created',
      sessionId: id,
      payload: note,
    });

    return { success: true, note };
  }

  @Post(':id/mock-interview/start')
  startMockInterview(
    @Param('id') id: string,
    @Body() body: { scenarioId?: string }
  ) {
    const session = this.sessionService.getSession(id);
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const scenarioId = body?.scenarioId || 'react-native-lead';
    const started = this.mockInterviewerService.startScenario(id, scenarioId);

    if (started) {
      this.sessionGateway.broadcastToSession(id, {
        event: 'mock.started',
        sessionId: id,
        payload: { scenarioId },
      });
    }

    return { success: started, scenarioId };
  }

  @Post(':id/mock-interview/stop')
  stopMockInterview(@Param('id') id: string) {
    this.mockInterviewerService.stopScenario(id);
    this.sessionGateway.broadcastToSession(id, {
      event: 'mock.stopped',
      sessionId: id,
      payload: { sessionId: id, status: 'stopped' },
    });
    return { success: true };
  }

  @Get(':id/mock-interview/status')
  getMockInterviewStatus(@Param('id') id: string) {
    return {
      running: this.mockInterviewerService.isRunning(id),
      scenarios: this.mockInterviewerService.getScenarios(),
    };
  }
}
