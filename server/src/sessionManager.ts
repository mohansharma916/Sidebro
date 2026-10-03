import {
  ContextProfile,
  DetectedQuestion,
  DeviceInfo,
  GeneratedAnswer,
  PostSessionSummary,
  QuestionCategory,
  SessionNote,
  SessionState,
  SessionType,
  TranscriptItem,
} from './types.js';
import { StorageEngine } from './storageEngine.js';

export class SessionManager {
  private storage: StorageEngine;
  private sessions: Map<string, SessionState> = new Map();
  private codeToSessionId: Map<string, string> = new Map();
  private transcripts: Map<string, TranscriptItem[]> = new Map();
  private questions: Map<string, DetectedQuestion[]> = new Map();
  private answers: Map<string, GeneratedAnswer[]> = new Map();
  private notes: Map<string, SessionNote[]> = new Map();
  private currentQuestion: Map<string, DetectedQuestion> = new Map();
  private durationIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(customDbPath?: string) {
    this.storage = new StorageEngine(customDbPath);
    this.loadFromStorage();
  }

  public getStorage(): StorageEngine {
    return this.storage;
  }

  /**
   * Pre-loads historical sessions and data from SQLite database on startup
   */
  private loadFromStorage(): void {
    try {
      const persistedSessions = this.storage.getAllSessions();
      for (const s of persistedSessions) {
        this.sessions.set(s.id, s);
        this.codeToSessionId.set(s.code, s.id);
        this.transcripts.set(s.id, this.storage.getTranscripts(s.id));
        this.questions.set(s.id, this.storage.getQuestions(s.id));
        this.answers.set(s.id, this.storage.getAnswers(s.id));
        this.notes.set(s.id, this.storage.getNotes(s.id));
      }
      if (persistedSessions.length > 0) {
        console.log(`[SessionManager] Loaded ${persistedSessions.length} historical sessions from SQLite.`);
      }
    } catch (err) {
      console.warn('[SessionManager] Notice loading from SQLite storage:', err);
    }
  }

  /**
   * Generates a unique 6-character uppercase alphanumeric code (e.g., A7X9KP)
   */
  private generateSessionCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous chars like 0, O, 1, I
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  public createSession(
    type: SessionType = 'technical',
    title?: string,
    profile?: ContextProfile,
    experienceLevel: 'junior' | 'mid' | 'senior' | 'staff' = 'senior'
  ): SessionState {
    const id = `sess-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    let code = this.generateSessionCode();
    while (this.codeToSessionId.has(code)) {
      code = this.generateSessionCode();
    }

    const session: SessionState = {
      id,
      code,
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
    this.sessions.set(id, session);
    this.codeToSessionId.set(code, id);
    this.transcripts.set(id, []);
    this.questions.set(id, []);
    this.answers.set(id, []);
    this.notes.set(id, []);

    // Persist session to SQLite
    this.storage.saveSession(session);

    // Start duration counter immediately
    if (!this.durationIntervals.has(id)) {
      const interval = setInterval(() => {
        if (session.status === 'active') {
          session.durationSeconds++;
        }
      }, 1000);
      this.durationIntervals.set(id, interval);
    }

    return session;
  }

  public getSession(id: string): SessionState | undefined {
    return this.sessions.get(id);
  }

  public getSessionByCode(code: string): SessionState | undefined {
    const id = this.codeToSessionId.get(code.toUpperCase().trim());
    if (!id) return undefined;
    return this.sessions.get(id);
  }

  public startSession(id: string): SessionState | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    session.status = 'active';
    session.startedAt = session.startedAt || Date.now();
    this.storage.updateSessionStatus(id, 'active', session.durationSeconds);

    if (!this.durationIntervals.has(id)) {
      const interval = setInterval(() => {
        if (session.status === 'active') {
          session.durationSeconds++;
        }
      }, 1000);
      this.durationIntervals.set(id, interval);
    }

    return session;
  }

  public pauseSession(id: string): SessionState | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    session.status = 'paused';
    this.storage.updateSessionStatus(id, 'paused', session.durationSeconds);
    return session;
  }

  public resumeSession(id: string): SessionState | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    session.status = 'active';
    this.storage.updateSessionStatus(id, 'active', session.durationSeconds);
    return session;
  }

  public endSession(id: string): SessionState | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    session.status = 'ended';
    session.endedAt = Date.now();
    this.storage.updateSessionStatus(id, 'ended', session.durationSeconds, session.endedAt);

    const interval = this.durationIntervals.get(id);
    if (interval) {
      clearInterval(interval);
      this.durationIntervals.delete(id);
    }

    return session;
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
    session.primaryConnected = session.devices.some(d => d.role === 'PRIMARY_CAPTURE');

    // Persist to SQLite
    this.storage.saveSession(session);
  }

  public setAudioStatus(id: string, micActive: boolean, systemAudioActive: boolean): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.micActive = micActive;
    session.systemAudioActive = systemAudioActive;
  }

  public addTranscript(transcript: TranscriptItem): void {
    const list = this.transcripts.get(transcript.sessionId);
    if (list) {
      list.push(transcript);
    }
    this.storage.saveTranscript(transcript);
  }

  public getTranscripts(sessionId: string): TranscriptItem[] {
    return this.transcripts.get(sessionId) || [];
  }

  public addQuestion(question: DetectedQuestion): void {
    const list = this.questions.get(question.sessionId);
    if (list) {
      list.push(question);
    }
    this.currentQuestion.set(question.sessionId, question);
    this.storage.saveQuestion(question);
  }

  public getCurrentQuestion(sessionId: string): DetectedQuestion | undefined {
    return this.currentQuestion.get(sessionId);
  }

  public getQuestions(sessionId: string): DetectedQuestion[] {
    return this.questions.get(sessionId) || [];
  }

  public addOrUpdateAnswer(answer: GeneratedAnswer): void {
    const list = this.answers.get(answer.sessionId);
    if (!list) return;

    const idx = list.findIndex(a => a.id === answer.id);
    if (idx >= 0) {
      list[idx] = answer;
    } else {
      list.push(answer);
    }
    this.storage.saveAnswer(answer);
  }

  public getAnswers(sessionId: string): GeneratedAnswer[] {
    return this.answers.get(sessionId) || [];
  }

  public addNote(note: SessionNote): void {
    const list = this.notes.get(note.sessionId);
    if (list) {
      list.push(note);
    }
    this.storage.saveNote(note);
  }

  public getNotes(sessionId: string): SessionNote[] {
    return this.notes.get(sessionId) || [];
  }

  public updateAnswerLength(sessionId: string, length: 'quick' | 'normal' | 'detailed'): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.answerLength = length;
    }
  }

  /**
   * Generates post-session summary and analytics (PRD Section 50-51)
   */
  public generateSummary(sessionId: string): PostSessionSummary | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    const questions = this.getQuestions(sessionId);
    const answers = this.getAnswers(sessionId);
    const notes = this.getNotes(sessionId);

    // Identify topics based on questions
    const topics = new Set<string>();
    const topicsToReview = new Set<string>();

    questions.forEach(q => {
      const qText = q.questionText.toLowerCase();
      if (qText.includes('react') || qText.includes('fiber')) topics.add('React Internals');
      if (qText.includes('bridge') || qText.includes('jsi')) topics.add('React Native Architecture');
      if (qText.includes('flatlist') || qText.includes('performance')) topics.add('Mobile Performance Optimization');
      if (qText.includes('rate limit') || qText.includes('system design')) topics.add('Distributed System Design');
      if (qText.includes('incident') || qText.includes('challenge')) topics.add('Incident Response (STAR)');

      if (q.type === 'System Design' || q.type === 'Coding') {
        topicsToReview.add(q.type);
      }
    });

    if (topics.size === 0) {
      topics.add('Technical Core');
      topics.add('Software Architecture');
    }

    const avgLatency = answers.length > 0
      ? Math.round(answers.reduce((acc, a) => acc + (a.firstTokenLatencyMs || 500), 0) / answers.length)
      : 420;

    const summary: PostSessionSummary = {
      sessionId,
      durationSeconds: session.durationSeconds,
      totalQuestions: questions.length,
      topicsDiscussed: Array.from(topics),
      topicsToReview: Array.from(topicsToReview),
      questions: questions.map(q => {
        const ans = answers.find(a => a.questionId === q.id);
        return {
          question: q.questionText,
          type: q.type,
          answerExcerpt: ans ? ans.directAnswer : 'Answer pending',
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

    if (this.durationIntervals.has(id)) {
      clearInterval(this.durationIntervals.get(id)!);
      this.durationIntervals.delete(id);
    }

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
