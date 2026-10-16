import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import type { IncomingMessage } from 'http';
import { WebSocket, Server } from 'ws';
import { SessionService } from './session.service.js';
import { ContextService } from '../context/context.service.js';
import { AiService } from '../ai/ai.service.js';
import { QuestionDetectorService } from './question-detector.service.js';
import { MockInterviewerService } from './mock-interviewer.service.js';
import type { AnswerModifier, AnswerStreamCallbacks, CodingInput } from '../aiEngine.js';
import { isAllowedOrigin } from '../common/origin.js';
import { RateLimiter } from '../common/rate-limiter.js';
import {
  ANSWER_LENGTHS,
  EXPERIENCE_LEVELS,
  MAX_CLIPBOARD_CHARS,
  MAX_NOTE_CHARS,
  MAX_QUESTION_CHARS,
  MAX_TRANSCRIPT_CHARS,
  MODIFIERS,
  SESSION_TYPES,
  SPEAKERS,
  cleanText,
  isSafeId,
  oneOf,
  sanitizeDevice,
  sanitizeProfile,
} from '../common/validation.js';
import {
  AnswerSource,
  DetectedQuestion,
  GeneratedAnswer,
  PostSessionSummary,
  QuestionCategory,
  SessionNote,
  SessionState,
  TranscriptItem,
  WSMessage,
} from '../types.js';

const PRIMARY_DISCONNECT_GRACE_MS = 10_000;
const SECOND_SCREEN_DISCONNECT_GRACE_MS = 45_000;
const MAX_WS_MESSAGE_BYTES = 64 * 1024;

type ClientMeta = { sessionId?: string; deviceId?: string };

/** Result of a session operation shared by the REST controller and the WebSocket gateway. */
export type OpResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 409 | 429; message: string };

@Injectable()
@WebSocketGateway({ path: '/ws' })
export class SessionGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(SessionGateway.name);
  private sessionClients: Map<string, Set<WebSocket>> = new Map();
  private clientMetadata: Map<WebSocket, ClientMeta> = new Map();
  /**
   * In-flight answer per session and source (voice, clipboard, screen). A newer question cancels
   * the older stream of the same source only, so the three panels never interrupt each other.
   */
  private inFlightAnswers: Map<string, AbortController> = new Map();
  private askLimiter = new RateLimiter(10, 60_000);
  private codingLimiter = new RateLimiter(20, 60_000);
  private joinLimiter = new RateLimiter(30, 60_000);

  constructor(
    private readonly sessionService: SessionService,
    private readonly contextService: ContextService,
    private readonly aiService: AiService,
    private readonly questionDetectorService: QuestionDetectorService,
    private readonly mockInterviewerService: MockInterviewerService
  ) {}

  onModuleInit() {
    // 1. Wire automatic question detector to streaming AI answer generation
    this.questionDetectorService.setOnQuestionDetected((question: DetectedQuestion) => {
      const session = this.sessionService.getSession(question.sessionId);
      if (!session || session.status !== 'active') return;
      this.publishQuestion(question);
    });

    // 2. Wire mock interviewer simulation
    this.mockInterviewerService.setOnTranscriptEmitted((transcript: TranscriptItem) => {
      this.handleTranscriptIngestion(transcript);
    });
  }

  afterInit(server: Server) {
    this.server = server;
    this.logger.log('NestJS WebSocket Gateway initialized on /ws');
  }

  handleConnection(client: WebSocket, req?: IncomingMessage) {
    const origin = req?.headers?.origin;
    if (!isAllowedOrigin(origin)) {
      this.logger.warn(`Rejected WebSocket connection from origin ${origin}`);
      client.close(1008, 'Origin not allowed');
      return;
    }

    this.clientMetadata.set(client, {});

    client.on('message', (raw: Buffer | string) => {
      void this.processMessage(client, raw);
    });
  }

  handleDisconnect(client: WebSocket) {
    const meta = this.clientMetadata.get(client);
    this.clientMetadata.delete(client);
    if (!meta?.sessionId) return;

    const sessionId = meta.sessionId;
    this.leaveRoom(client, sessionId);

    if (!meta.deviceId) return;
    const deviceId = meta.deviceId;
    const device = this.sessionService.getSession(sessionId)?.devices?.find(d => d.id === deviceId);
    const grace = device?.role === 'PRIMARY_CAPTURE' ? PRIMARY_DISCONNECT_GRACE_MS : SECOND_SCREEN_DISCONNECT_GRACE_MS;

    // Grace period: transient drops (Wi-Fi blips, phone screen locks) should not flap the device list.
    setTimeout(() => {
      if (!this.sessionService.getSession(sessionId)) return;
      const clients = this.sessionClients.get(sessionId);
      const reconnected = clients && Array.from(clients).some(c => this.clientMetadata.get(c)?.deviceId === deviceId);
      if (reconnected) return;

      this.sessionService.removeDevice(sessionId, deviceId);
      this.broadcastToSession(sessionId, {
        event: 'device.disconnected',
        sessionId,
        payload: { deviceId },
      });
    }, grace).unref();
  }

  private joinRoom(client: WebSocket, sessionId: string): void {
    const meta = this.clientMetadata.get(client);
    if (!meta) return;
    if (meta.sessionId && meta.sessionId !== sessionId) {
      this.leaveRoom(client, meta.sessionId);
    }
    meta.sessionId = sessionId;
    if (!this.sessionClients.has(sessionId)) {
      this.sessionClients.set(sessionId, new Set());
    }
    this.sessionClients.get(sessionId)?.add(client);
  }

  private leaveRoom(client: WebSocket, sessionId: string): void {
    const clients = this.sessionClients.get(sessionId);
    if (!clients) return;
    clients.delete(client);
    if (clients.size === 0) {
      this.sessionClients.delete(sessionId);
    }
  }

  public broadcastToSession(sessionId: string, message: WSMessage, excludeWs?: WebSocket): void {
    const clients = this.sessionClients.get(sessionId);
    if (!clients || clients.size === 0) {
      return;
    }

    const data = JSON.stringify(message);
    for (const client of clients) {
      if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  private sendTo(client: WebSocket, message: WSMessage): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  private sendError(client: WebSocket, message: string, sessionId?: string): void {
    this.sendTo(client, { event: 'error', sessionId, payload: { message } });
  }

  // ---------------------------------------------------------------------------
  // Session operations shared by REST and WebSocket entry points
  // ---------------------------------------------------------------------------

  public async triggerAnswerGeneration(question: DetectedQuestion, actionModifier?: AnswerModifier): Promise<void> {
    const session = this.sessionService.getSession(question.sessionId);
    if (!session) return;

    const relevantChunks = this.contextService.retrieveContext(session.profile, question.questionText, 3);
    const recentTranscripts = this.recentTranscripts(question.sessionId);

    await this.runAnswerStream(question, (callbacks, signal) =>
      this.aiService.streamAnswer(
        question,
        session.type,
        session.answerLength,
        relevantChunks.map(r => r.chunk),
        recentTranscripts,
        callbacks,
        actionModifier,
        signal
      )
    );
  }

  private async triggerCodingAnswer(question: DetectedQuestion, input: CodingInput): Promise<void> {
    const session = this.sessionService.getSession(question.sessionId);
    if (!session) return;
    const recentTranscripts = this.recentTranscripts(question.sessionId);
    await this.runAnswerStream(question, (callbacks, signal) =>
      this.aiService.streamCodingAnswer(question, input, recentTranscripts, callbacks, session.profile?.preferredLanguage, signal)
    );
  }

  private recentTranscripts(sessionId: string): { speaker: string; text: string }[] {
    return this.sessionService
      .getTranscripts(sessionId)
      .slice(-6)
      .map(t => ({ speaker: t.speaker, text: t.text }));
  }

  /** Streams an answer to every device in the session, cancelling only the previous answer of the same source. */
  private async runAnswerStream(
    question: DetectedQuestion,
    stream: (callbacks: AnswerStreamCallbacks, signal: AbortSignal) => Promise<void>
  ): Promise<void> {
    const key = `${question.sessionId}:${question.source || 'voice'}`;
    this.inFlightAnswers.get(key)?.abort();
    const controller = new AbortController();
    this.inFlightAnswers.set(key, controller);

    let answerId = '';
    try {
      await stream(
        {
          onStart: (answer: GeneratedAnswer) => {
            answerId = answer.id;
            this.sessionService.addOrUpdateAnswer(answer);
            this.broadcastToSession(question.sessionId, {
              event: 'answer.started',
              sessionId: question.sessionId,
              payload: answer,
            });
          },
          onToken: (token: string) => {
            // Deltas only; clients append them to the answer with the same id.
            this.broadcastToSession(question.sessionId, {
              event: 'answer.token',
              sessionId: question.sessionId,
              payload: { answerId, questionId: question.id, token },
            });
          },
          onComplete: (answer: GeneratedAnswer) => {
            this.sessionService.addOrUpdateAnswer(answer);
            this.broadcastToSession(question.sessionId, {
              event: 'answer.completed',
              sessionId: question.sessionId,
              payload: answer,
            });
          },
          onError: (err: any) => {
            this.broadcastToSession(question.sessionId, {
              event: 'error',
              sessionId: question.sessionId,
              payload: { message: err?.message || 'Error generating answer' },
            });
          },
        },
        controller.signal
      );
    } catch (err) {
      this.logger.error('Error in answer generation:', err as Error);
    } finally {
      if (this.inFlightAnswers.get(key) === controller) {
        this.inFlightAnswers.delete(key);
      }
    }
  }

  private abortAnswers(sessionId: string): void {
    for (const [key, controller] of this.inFlightAnswers) {
      if (key.startsWith(`${sessionId}:`)) controller.abort();
    }
  }

  private publishQuestion(question: DetectedQuestion): void {
    this.sessionService.addQuestion(question);
    this.broadcastToSession(question.sessionId, {
      event: 'question.detected',
      sessionId: question.sessionId,
      payload: question,
    });
    void this.triggerAnswerGeneration(question);
  }

  /** Stores and broadcasts a transcript, then feeds the question detector. Duplicate ids are ignored. */
  public handleTranscriptIngestion(transcript: TranscriptItem): boolean {
    if (!this.sessionService.addTranscript(transcript)) return false;
    this.broadcastToSession(transcript.sessionId, {
      event: 'transcript.final',
      sessionId: transcript.sessionId,
      payload: transcript,
    });
    const session = this.sessionService.getSession(transcript.sessionId);
    // When system audio is not active, mic is the only audio source, so evaluate candidate speech for questions
    const allowCandidate = !session?.systemAudioActive;
    this.questionDetectorService.ingestTranscript(transcript, allowCandidate);
    return true;
  }

  public ingestTranscript(
    sessionId: string,
    input: { speaker?: unknown; text?: unknown; clientId?: unknown; confidence?: unknown }
  ): OpResult<TranscriptItem | null> {
    const session = this.sessionService.getSession(sessionId);
    if (!session) return { ok: false, status: 404, message: 'Session not found' };
    if (session.status !== 'active') return { ok: false, status: 409, message: `Session is ${session.status}; transcript ignored` };
    const text = cleanText(input.text, MAX_TRANSCRIPT_CHARS);
    if (!text) return { ok: false, status: 400, message: 'Transcript text is required' };

    // A client-supplied id makes retries idempotent (same utterance sent twice is stored once).
    const id = isSafeId(input.clientId)
      ? `tr-${input.clientId}`
      : `tr-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const transcript: TranscriptItem = {
      id,
      sessionId,
      speaker: oneOf(input.speaker, SPEAKERS) || 'OTHER',
      text,
      isFinal: true,
      timestamp: Date.now(),
      confidence: typeof input.confidence === 'number' ? Math.max(0, Math.min(1, input.confidence)) : 0.95,
    };
    const added = this.handleTranscriptIngestion(transcript);
    return { ok: true, value: added ? transcript : null };
  }

  public askQuestion(sessionId: string, rawText: unknown, category?: QuestionCategory): OpResult<DetectedQuestion> {
    const session = this.sessionService.getSession(sessionId);
    if (!session) return { ok: false, status: 404, message: 'Session not found' };
    if (session.status === 'ended') return { ok: false, status: 409, message: 'Session has ended' };
    const questionText = cleanText(rawText, MAX_QUESTION_CHARS);
    if (!questionText) return { ok: false, status: 400, message: 'Question text is required' };
    if (!this.askLimiter.allow(sessionId)) return { ok: false, status: 429, message: 'Too many questions; slow down' };

    const question: DetectedQuestion = {
      id: `q-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      sessionId,
      questionText,
      type: category || 'manual',
      timestamp: Date.now(),
      confidence: 1.0,
    };
    this.publishQuestion(question);
    return { ok: true, value: question };
  }

  /**
   * Solves a coding problem from copied text or a screenshot. Runs alongside the voice answer
   * without cancelling it; a newer copy/screenshot replaces only the previous one of its kind.
   */
  public solveCoding(sessionId: string, source: Exclude<AnswerSource, 'voice'>, input: CodingInput): OpResult<DetectedQuestion> {
    const session = this.sessionService.getSession(sessionId);
    if (!session) return { ok: false, status: 404, message: 'Session not found' };
    if (session.status === 'ended') return { ok: false, status: 409, message: 'Session has ended' };
    if (input.kind === 'text') {
      const text = cleanText(input.text, MAX_CLIPBOARD_CHARS);
      if (!text) return { ok: false, status: 400, message: 'Text is required' };
      input = { kind: 'text', text };
    }
    if (!this.codingLimiter.allow(sessionId)) return { ok: false, status: 429, message: 'Too many requests; slow down' };

    const question: DetectedQuestion = {
      id: `q-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      sessionId,
      questionText: input.kind === 'text' ? input.text : 'Coding problem from screenshot',
      type: 'Coding',
      timestamp: Date.now(),
      confidence: 1.0,
      source,
    };
    this.sessionService.addQuestion(question);
    this.broadcastToSession(sessionId, { event: 'question.detected', sessionId, payload: question });
    void this.triggerCodingAnswer(question, input);
    return { ok: true, value: question };
  }

  public regenerate(sessionId: string, questionId: unknown, rawModifier: unknown): OpResult<DetectedQuestion> {
    const session = this.sessionService.getSession(sessionId);
    if (!session) return { ok: false, status: 404, message: 'Session not found' };
    if (session.status === 'ended') return { ok: false, status: 409, message: 'Session has ended' };
    const modifier = rawModifier === undefined ? undefined : oneOf(rawModifier, MODIFIERS);
    if (rawModifier !== undefined && !modifier) return { ok: false, status: 400, message: 'Unknown modifier' };
    const target = this.sessionService.getQuestions(sessionId).find(q => q.id === questionId);
    if (!target) return { ok: false, status: 404, message: 'Question not found' };
    if (!this.askLimiter.allow(sessionId)) return { ok: false, status: 429, message: 'Too many requests; slow down' };

    void this.triggerAnswerGeneration(target, modifier);
    return { ok: true, value: target };
  }

  public addNote(sessionId: string, rawText: unknown, questionId?: unknown): OpResult<SessionNote> {
    if (!this.sessionService.getSession(sessionId)) return { ok: false, status: 404, message: 'Session not found' };
    const text = cleanText(rawText, MAX_NOTE_CHARS);
    if (!text) return { ok: false, status: 400, message: 'Note text is required' };

    const note: SessionNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      sessionId,
      questionId: isSafeId(questionId) ? questionId : undefined,
      text,
      timestamp: Date.now(),
    };
    this.sessionService.addNote(note);
    this.broadcastToSession(sessionId, { event: 'note.created', sessionId, payload: note });
    return { ok: true, value: note };
  }

  public pause(sessionId: string): SessionState | undefined {
    const session = this.sessionService.pauseSession(sessionId);
    if (session) {
      this.abortAnswers(sessionId);
      this.broadcastToSession(sessionId, {
        event: 'session.paused',
        sessionId,
        payload: { durationSeconds: session.durationSeconds, status: session.status },
      });
    }
    return session;
  }

  public resume(sessionId: string): SessionState | undefined {
    const session = this.sessionService.resumeSession(sessionId);
    if (session) {
      this.broadcastToSession(sessionId, {
        event: 'session.resumed',
        sessionId,
        payload: { durationSeconds: session.durationSeconds, status: session.status },
      });
    }
    return session;
  }

  public end(sessionId: string): { session: SessionState; summary?: PostSessionSummary } | undefined {
    const session = this.sessionService.endSession(sessionId);
    if (!session) return undefined;
    this.abortAnswers(sessionId);
    this.mockInterviewerService.stopScenario(sessionId);
    this.questionDetectorService.clearSession(sessionId);
    const summary = this.sessionService.generateSummary(sessionId);
    this.broadcastToSession(sessionId, {
      event: 'session.ended',
      sessionId,
      payload: { summary, durationSeconds: session.durationSeconds },
    });
    return { session, summary };
  }

  public startMock(sessionId: string, rawScenarioId: unknown): OpResult<string> {
    const session = this.sessionService.getSession(sessionId);
    if (!session) return { ok: false, status: 404, message: 'Session not found' };
    if (session.status !== 'active') return { ok: false, status: 409, message: `Session is ${session.status}` };
    const scenarios = this.mockInterviewerService.getScenarios();
    const scenarioId = typeof rawScenarioId === 'string' && scenarios.some(s => s.id === rawScenarioId)
      ? rawScenarioId
      : scenarios[0].id;
    this.mockInterviewerService.startScenario(sessionId, scenarioId);
    this.broadcastToSession(sessionId, { event: 'mock.started', sessionId, payload: { scenarioId } });
    return { ok: true, value: scenarioId };
  }

  public stopMock(sessionId: string): void {
    this.mockInterviewerService.stopScenario(sessionId);
    this.broadcastToSession(sessionId, {
      event: 'mock.stopped',
      sessionId,
      payload: { sessionId, status: 'stopped' },
    });
  }

  // ---------------------------------------------------------------------------
  // WebSocket message handling
  // ---------------------------------------------------------------------------

  private async processMessage(client: WebSocket, raw: Buffer | string): Promise<void> {
    try {
      const size = typeof raw === 'string' ? Buffer.byteLength(raw) : raw.length;
      if (size > MAX_WS_MESSAGE_BYTES) {
        this.sendError(client, 'Message too large');
        return;
      }

      let msg: WSMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        this.sendError(client, 'Invalid JSON');
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof msg.event !== 'string') return;

      const meta = this.clientMetadata.get(client);
      if (!meta) return;
      const payload: any = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};

      // Events that do not require membership in a session
      switch (msg.event) {
        case 'ping': {
          const joined = meta.sessionId ? this.sessionService.getSession(meta.sessionId) : undefined;
          this.sendTo(client, {
            event: 'pong',
            sessionId: meta.sessionId,
            payload: { time: payload.time, durationSeconds: joined?.durationSeconds },
          });
          return;
        }

        case 'session.create': {
          const session = this.sessionService.createSession(
            oneOf(payload.type, SESSION_TYPES),
            cleanText(payload.title, 200),
            sanitizeProfile(payload.profile),
            oneOf(payload.experienceLevel, EXPERIENCE_LEVELS)
          );
          this.joinRoom(client, session.id);
          this.sendTo(client, { event: 'session.created', sessionId: session.id, payload: session });
          return;
        }

        case 'session.join': {
          this.handleJoin(client, meta, payload);
          return;
        }
      }

      // Everything else requires a validated join, and only acts on the joined session.
      const sessionId = meta.sessionId;
      if (!sessionId) {
        this.sendError(client, 'Join a session first');
        return;
      }
      if (msg.sessionId && msg.sessionId !== sessionId) {
        this.sendError(client, 'Message sessionId does not match the joined session', sessionId);
        return;
      }

      const reply = (result: OpResult<unknown>) => {
        if (!result.ok) this.sendError(client, result.message, sessionId);
      };

      switch (msg.event) {
        case 'session.update': {
          const answerLength = oneOf(payload.answerLength, ANSWER_LENGTHS);
          if (!answerLength) {
            this.sendError(client, 'Invalid answerLength', sessionId);
            return;
          }
          this.sessionService.updateAnswerLength(sessionId, answerLength);
          this.broadcastToSession(sessionId, { event: 'session.update', sessionId, payload: { answerLength } });
          break;
        }

        case 'audio.status': {
          const micActive = !!payload.micActive;
          const systemAudioActive = !!payload.systemAudioActive;
          this.sessionService.setAudioStatus(sessionId, micActive, systemAudioActive);
          this.broadcastToSession(sessionId, { event: 'audio.status', sessionId, payload: { micActive, systemAudioActive } }, client);
          break;
        }

        case 'transcript.partial': {
          const text = cleanText(payload.text, MAX_TRANSCRIPT_CHARS);
          if (!text) return;
          this.broadcastToSession(
            sessionId,
            { event: 'transcript.partial', sessionId, payload: { speaker: oneOf(payload.speaker, SPEAKERS) || 'OTHER', text } },
            client
          );
          break;
        }

        case 'transcript.final':
          reply(this.ingestTranscript(sessionId, payload));
          break;

        case 'action.regenerate':
          reply(this.regenerate(sessionId, payload.questionId, payload.modifier));
          break;

        case 'manual.ask':
          reply(this.askQuestion(sessionId, payload.questionText));
          break;

        case 'note.create':
          reply(this.addNote(sessionId, payload.text, payload.questionId));
          break;

        case 'session.pause':
          this.pause(sessionId);
          break;

        case 'session.resume':
          this.resume(sessionId);
          break;

        case 'session.end':
          this.end(sessionId);
          break;

        case 'mock.start':
          reply(this.startMock(sessionId, payload.scenarioId));
          break;

        case 'mock.stop':
          this.stopMock(sessionId);
          break;

        default:
          break;
      }
    } catch (err) {
      this.logger.error('Failed to handle incoming WebSocket message:', err as Error);
    }
  }

  private handleJoin(client: WebSocket, meta: ClientMeta, payload: any): void {
    const { sessionId, token, code } = payload;

    let session: SessionState | undefined;
    if (typeof sessionId === 'string' && typeof token === 'string') {
      // Reconnect with the token the client received at create/join time
      if (this.sessionService.verifyToken(sessionId, token)) {
        session = this.sessionService.getSession(sessionId);
      }
    } else if (typeof code === 'string') {
      // Throttle code guessing (codes are the pairing secret)
      if (!this.joinLimiter.allow('code-join')) {
        this.sendError(client, 'Too many join attempts; try again in a minute');
        return;
      }
      session = this.sessionService.getSessionByCode(code);
    }

    if (!session) {
      this.sendError(client, 'Session not found, expired, or invalid credentials');
      return;
    }

    this.joinRoom(client, session.id);
    const device = sanitizeDevice(payload.device);
    if (device) {
      meta.deviceId = device.id;
      this.sessionService.addDevice(session.id, device);
    }

    // Reply with joined session state (including the token for later reconnects) and full history
    this.sendTo(client, {
      event: 'session.joined',
      sessionId: session.id,
      payload: {
        session,
        transcripts: this.sessionService.getTranscripts(session.id),
        questions: this.sessionService.getQuestions(session.id),
        answers: this.sessionService.getAnswers(session.id),
        notes: this.sessionService.getNotes(session.id),
        currentQuestion: this.sessionService.getCurrentQuestion(session.id),
      },
    });

    if (device) {
      this.broadcastToSession(session.id, { event: 'device.connected', sessionId: session.id, payload: device }, client);
    }
  }
}
