import crypto from 'crypto';
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
} from './types.js';
import { StorageEngine } from './storageEngine.js';

/** Pairing codes stop resolving after this long (the session itself is kept). */
const CODE_TTL_MS = 12 * 60 * 60 * 1000;
/** How often the running duration is flushed to SQLite. */
const DURATION_PERSIST_EVERY_S = 15;

const isVoice = (q: DetectedQuestion) => !q.source || q.source === 'voice';

export class SessionManager {
  protected readonly storage: StorageEngine;
  private sessions: Map<string, SessionState> = new Map();
  private codeToSessionId: Map<string, string> = new Map();
  // Per-session child collections are loaded lazily from SQLite on first access
  private transcripts: Map<string, TranscriptItem[]> = new Map();
  private questions: Map<string, DetectedQuestion[]> = new Map();
  private answers: Map<string, GeneratedAnswer[]> = new Map();
  private notes: Map<string, SessionNote[]> = new Map();
  private currentQuestion: Map<string, DetectedQuestion> = new Map();
  private durationIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(storage: StorageEngine) {
    this.storage = storage;
    this.loadFromStorage();
  }

  public getStorage(): StorageEngine {
    return this.storage;
  }

  /**
   * Loads session metadata from SQLite on startup. Transcripts, questions, answers and
   * notes are loaded on demand. Sessions that were active when the server stopped are
   * marked paused so their clock can be resumed explicitly.
   */
  private loadFromStorage(): void {
    const persistedSessions = this.storage.getAllSessions();
    for (const s of persistedSessions) {
      let dirty = false;
      if (!s.token) {
        s.token = SessionManager.generateToken();
        dirty = true;
      }
      if (s.status === 'active') {
        s.status = 'paused';
        dirty = true;
      }
      if (dirty) this.storage.saveSession(s);
      this.sessions.set(s.id, s);
      this.codeToSessionId.set(s.code, s.id);
    }
    if (persistedSessions.length > 0) {
      console.log(`[SessionManager] Loaded ${persistedSessions.length} historical sessions from SQLite.`);
    }
  }

  private static generateToken(): string {
    return crypto.randomBytes(24).toString('base64url');
  }

  /**
   * Generates a unique 6-character uppercase alphanumeric code (e.g., A7X9KP)
   */
  private generateSessionCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous chars like 0, O, 1, I
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(crypto.randomInt(chars.length));
    }
    return code;
  }

  private startDurationTimer(session: SessionState): void {
    if (this.durationIntervals.has(session.id)) return;
    const interval = setInterval(() => {
      if (session.status === 'active') {
        session.durationSeconds++;
        if (session.durationSeconds % DURATION_PERSIST_EVERY_S === 0) {
          this.storage.updateSessionDuration(session.id, session.durationSeconds);
        }
      }
    }, 1000);
    interval.unref();
    this.durationIntervals.set(session.id, interval);
  }

  private stopDurationTimer(id: string): void {
    const interval = this.durationIntervals.get(id);
    if (interval) {
      clearInterval(interval);
      this.durationIntervals.delete(id);
    }
  }

  public createSession(
    type: SessionType = 'technical',
    title?: string,
    profile?: ContextProfile,
    experienceLevel: ExperienceLevel = 'senior'
  ): SessionState {
    const id = `sess-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    let code = this.generateSessionCode();
    while (this.codeToSessionId.has(code)) {
      code = this.generateSessionCode();
    }

    const session: SessionState = {
      id,
      code,
      token: SessionManager.generateToken(),
      title: title || `${type.charAt(0).toUpperCase() + type.slice(1)} Session`,
      type,
      status: 'active',
      createdAt: Date.now(),
      startedAt: Date.now(),
      durationSeconds: 0,
      answerLength: 'normal',
      experienceLevel,
      profile,
      devices: [
        {
          id: 'primary-capture-device',
          name: 'Primary Mac/PC (Capture Agent)',
          type: 'CAPTURE',
          role: 'PRIMARY_CAPTURE',
          connectedAt: Date.now(),
          lastSeen: Date.now(),
        }
      ],
      primaryConnected: true,
      micActive: true,
      systemAudioActive: true,
    };

    this.sessions.set(id, session);
    this.codeToSessionId.set(code, id);
    this.transcripts.set(id, []);
    this.questions.set(id, []);
    this.answers.set(id, []);
    this.notes.set(id, []);

    // Persist session to SQLite
    this.storage.saveSession(session);
    this.startDurationTimer(session);

    return session;
  }

  public getSession(id: string): SessionState | undefined {
    return this.sessions.get(id);
  }

  /**
   * Resolves a pairing code. Codes of ended sessions, and codes older than the TTL, no longer resolve.
   */
  public getSessionByCode(code: string): SessionState | undefined {
    const id = this.codeToSessionId.get(code.toUpperCase().trim());
    if (!id) return undefined;
    const session = this.sessions.get(id);
    if (!session || session.status === 'ended') return undefined;
    if (Date.now() - session.createdAt > CODE_TTL_MS) return undefined;
    return session;
  }

  /** Constant-time token comparison. */
  public verifyToken(id: string, token: string | undefined): boolean {
    const session = this.sessions.get(id);
    if (!session?.token || !token) return false;
    const a = Buffer.from(session.token);
    const b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  public pauseSession(id: string): SessionState | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.status === 'ended') return session;
    session.status = 'paused';
    this.storage.updateSessionStatus(id, 'paused', session.durationSeconds);
    return session;
  }

  public resumeSession(id: string): SessionState | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.status === 'ended') return session;
    session.status = 'active';
    session.startedAt = session.startedAt || Date.now();
    this.storage.updateSessionStatus(id, 'active', session.durationSeconds);
    this.startDurationTimer(session);
    return session;
  }

  public endSession(id: string): SessionState | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.status === 'ended') return session;

    session.status = 'ended';
    session.endedAt = Date.now();
    this.storage.updateSessionStatus(id, 'ended', session.durationSeconds, session.endedAt);
    this.stopDurationTimer(id);

    return session;
  }

  /** Called on shutdown: stop timers and pause running sessions, leaving ended ones untouched. */
  public shutdown(): void {
    for (const [id, session] of this.sessions) {
      this.stopDurationTimer(id);
      if (session.status === 'active') {
        this.pauseSession(id);
      }
    }
  }

  public addDevice(id: string, device: DeviceInfo): void {
    const session = this.sessions.get(id);
    if (!session) return;

    if (!session.devices) {
      session.devices = [];
    }

    const existingIdx = session.devices.findIndex(d => d.id === device.id);
    const updatedDevice: DeviceInfo = {
      ...device,
      lastSeen: Date.now(),
      connectedAt: existingIdx >= 0 ? session.devices[existingIdx].connectedAt : Date.now(),
    };

    if (existingIdx >= 0) {
      session.devices[existingIdx] = updatedDevice;
    } else {
      session.devices.push(updatedDevice);
    }

    if (device.role === 'PRIMARY_CAPTURE') {
      session.primaryConnected = true;
    }

    // Persist updated device inventory to SQLite
    this.storage.saveSession(session);
  }

  public removeDevice(id: string, deviceId: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    // Do not remove PRIMARY_CAPTURE from list entirely; just toggle status
    const dev = session.devices.find(d => d.id === deviceId);
    if (dev && dev.role === 'PRIMARY_CAPTURE') {
      session.primaryConnected = false;
    } else {
      session.devices = session.devices.filter(d => d.id !== deviceId);
    }

    // Persist to SQLite
    this.storage.saveSession(session);
  }

  public setAudioStatus(id: string, micActive: boolean, systemAudioActive: boolean): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.micActive = !!micActive;
    session.systemAudioActive = !!systemAudioActive;
  }

  private lazyList<T>(map: Map<string, T[]>, sessionId: string, load: (id: string) => T[]): T[] {
    let list = map.get(sessionId);
    if (!list) {
      if (!this.sessions.has(sessionId)) return [];
      list = load(sessionId);
      map.set(sessionId, list);
    }
    return list;
  }

  /**
   * Stores a transcript. Returns false if a transcript with the same id already exists
   * (e.g. the same utterance retried over REST after a WebSocket send).
   */
  public addTranscript(transcript: TranscriptItem): boolean {
    const list = this.lazyList(this.transcripts, transcript.sessionId, id => this.storage.getTranscripts(id));
    if (list.some(t => t.id === transcript.id)) return false;
    list.push(transcript);
    this.storage.saveTranscript(transcript);
    return true;
  }

  public getTranscripts(sessionId: string): TranscriptItem[] {
    return this.lazyList(this.transcripts, sessionId, id => this.storage.getTranscripts(id));
  }

  public addQuestion(question: DetectedQuestion): void {
    this.getQuestions(question.sessionId).push(question);
    // Clipboard and screenshot questions have their own panels; "current" tracks the voice flow only.
    if (isVoice(question)) this.currentQuestion.set(question.sessionId, question);
    this.storage.saveQuestion(question);
  }

  public getCurrentQuestion(sessionId: string): DetectedQuestion | undefined {
    const current = this.currentQuestion.get(sessionId);
    if (current) return current;
    return [...this.getQuestions(sessionId)].reverse().find(isVoice);
  }

  public getQuestions(sessionId: string): DetectedQuestion[] {
    return this.lazyList(this.questions, sessionId, id => this.storage.getQuestions(id));
  }

  public addOrUpdateAnswer(answer: GeneratedAnswer): void {
    if (!this.sessions.has(answer.sessionId)) return;
    const list = this.getAnswers(answer.sessionId);

    const idx = list.findIndex(a => a.id === answer.id);
    if (idx >= 0) {
      list[idx] = answer;
    } else {
      list.push(answer);
    }
    this.storage.saveAnswer(answer);
  }

  public getAnswers(sessionId: string): GeneratedAnswer[] {
    return this.lazyList(this.answers, sessionId, id => this.storage.getAnswers(id));
  }

  public addNote(note: SessionNote): void {
    this.getNotes(note.sessionId).push(note);
    this.storage.saveNote(note);
  }

  public getNotes(sessionId: string): SessionNote[] {
    return this.lazyList(this.notes, sessionId, id => this.storage.getNotes(id));
  }

  public updateAnswerLength(sessionId: string, length: AnswerLengthMode): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.answerLength = length;
      this.storage.saveSession(session);
    }
  }

  /**
   * Generates post-session summary and analytics from the recorded questions and answers.
   */
  public generateSummary(sessionId: string): PostSessionSummary | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    const questions = this.getQuestions(sessionId);
    const answers = this.getAnswers(sessionId);
    const notes = this.getNotes(sessionId);

    const latestAnswerFor = (questionId: string) =>
      [...answers].reverse().find(a => a.questionId === questionId);

    const topics = new Set<string>();
    const topicsToReview = new Set<string>();

    questions.forEach(q => {
      const category = q.type === 'manual' ? 'Manual Questions' : q.type;
      topics.add(category);
      const ans = latestAnswerFor(q.id);
      if (q.type === 'System Design' || q.type === 'Coding' || !ans || !ans.isComplete) {
        topicsToReview.add(category);
      }
    });

    const measured = answers.filter(a => typeof a.firstTokenLatencyMs === 'number');
    const avgLatency = measured.length > 0
      ? Math.round(measured.reduce((acc, a) => acc + (a.firstTokenLatencyMs as number), 0) / measured.length)
      : 0;

    const summary: PostSessionSummary = {
      sessionId,
      durationSeconds: session.durationSeconds,
      totalQuestions: questions.length,
      topicsDiscussed: Array.from(topics),
      topicsToReview: Array.from(topicsToReview),
      questions: questions.map(q => {
        const ans = latestAnswerFor(q.id);
        return {
          question: q.questionText,
          type: q.type,
          answerExcerpt: ans ? ans.directAnswer || ans.fullContent.slice(0, 200) : 'Answer pending',
        };
      }),
      notesCount: notes.length,
      avgResponseLatencyMs: avgLatency,
    };

    // Persist summary to SQLite analytics table
    this.storage.saveSummary(summary);

    return summary;
  }

  public getAllSessions(): SessionState[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  public deleteSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    this.stopDurationTimer(id);
    this.codeToSessionId.delete(session.code);
    this.sessions.delete(id);
    this.transcripts.delete(id);
    this.questions.delete(id);
    this.answers.delete(id);
    this.notes.delete(id);
    this.currentQuestion.delete(id);

    // Delete from SQLite database
    this.storage.deleteSession(id);
    return true;
  }
}
