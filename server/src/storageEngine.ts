import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import {
  ContextProfile,
  DetectedQuestion,
  DeviceInfo,
  GeneratedAnswer,
  PostSessionSummary,
  QuestionCategory,
  SessionNote,
  SessionState,
  TranscriptItem,
} from './types.js';

export interface GlobalAnalytics {
  totalSessions: number;
  totalQuestions: number;
  totalTranscripts: number;
  totalAnswers: number;
  avgLatencyMs: number;
  questionsByCategory: Record<string, number>;
  answersByModel: Record<string, number>;
  totalDurationSeconds: number;
}

export interface CodingSolutionItem {
  questionId: string;
  sessionId: string;
  questionText: string;
  category: string;
  directAnswer: string;
  keyPoints: string[];
  codeSnippet: string | null;
  fullContent: string;
  model: string;
  totalLatencyMs: number;
  timestamp: number;
}

export interface SessionDebugDump {
  session: SessionState | null;
  transcripts: TranscriptItem[];
  questions: DetectedQuestion[];
  answers: GeneratedAnswer[];
  notes: SessionNote[];
  summary: PostSessionSummary | null;
  exportedAt: number;
}

export class StorageEngine {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(customPath?: string) {
    const dataDir = customPath
      ? path.dirname(customPath)
      : path.resolve(process.cwd(), 'server/data');

    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (err) {
        console.warn('[StorageEngine] Notice creating data directory:', err);
      }
    }

    this.dbPath = customPath || path.resolve(dataDir, 'copilot.sqlite');
    this.db = new DatabaseSync(this.dbPath);

    this.initPragmas();
    this.initSchema();
    console.log(`[StorageEngine] SQLite persistent storage initialized at: ${this.dbPath}`);
  }

  private initPragmas(): void {
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
      this.db.exec('PRAGMA foreign_keys = ON;');
    } catch (err) {
      console.warn('[StorageEngine] Error setting SQLite pragmas:', err);
    }
  }

  private initSchema(): void {
    // 1. Sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        duration_seconds INTEGER DEFAULT 0,
        answer_length TEXT DEFAULT 'normal',
        experience_level TEXT DEFAULT 'senior',
        profile_json TEXT,
        devices_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_code ON sessions(code);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
    `);

    // 2. Transcripts table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        speaker TEXT NOT NULL,
        text TEXT NOT NULL,
        is_final INTEGER NOT NULL DEFAULT 1,
        confidence REAL DEFAULT 1.0,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_transcripts_session ON transcripts(session_id);
      CREATE INDEX IF NOT EXISTS idx_transcripts_time ON transcripts(timestamp);
    `);

    // 3. Questions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        transcript_id TEXT,
        question_text TEXT NOT NULL,
        category TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        context_summary TEXT,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id);
      CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category);
      CREATE INDEX IF NOT EXISTS idx_questions_time ON questions(timestamp);
    `);

    // 4. Answers table (Answers, code snippets, follow-ups, and latency metrics)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS answers (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        question_text TEXT NOT NULL,
        direct_answer TEXT NOT NULL,
        key_points_json TEXT NOT NULL,
        code_snippet TEXT,
        follow_ups_json TEXT,
        full_content TEXT NOT NULL,
        is_complete INTEGER NOT NULL DEFAULT 0,
        length_mode TEXT NOT NULL,
        model TEXT NOT NULL,
        context_used_json TEXT,
        first_token_latency_ms INTEGER,
        total_latency_ms INTEGER,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);
      CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);
      CREATE INDEX IF NOT EXISTS idx_answers_model ON answers(model);
    `);

    // 5. Notes table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        question_id TEXT,
        text TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notes_session ON notes(session_id);
    `);

    // 6. Analytics & Post-Session Summaries
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analytics_summaries (
        session_id TEXT PRIMARY KEY,
        duration_seconds INTEGER NOT NULL,
        total_questions INTEGER NOT NULL,
        avg_response_latency_ms INTEGER NOT NULL,
        topics_discussed_json TEXT NOT NULL,
        topics_to_review_json TEXT NOT NULL,
        questions_summary_json TEXT NOT NULL,
        notes_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  // --- Session Methods ---

  public saveSession(session: SessionState): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        id, code, title, type, status, created_at, started_at, ended_at,
        duration_seconds, answer_length, experience_level, profile_json, devices_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        duration_seconds = excluded.duration_seconds,
        answer_length = excluded.answer_length,
        profile_json = excluded.profile_json,
        devices_json = excluded.devices_json;
    `);

    stmt.run(
      session.id,
      session.code,
      session.title,
      session.type,
      session.status,
      session.createdAt,
      session.startedAt || null,
      session.endedAt || null,
      session.durationSeconds || 0,
      session.answerLength || 'normal',
      session.experienceLevel || 'senior',
      session.profile ? JSON.stringify(session.profile) : null,
      session.devices ? JSON.stringify(session.devices) : '[]'
    );
  }

  public updateSessionStatus(
    sessionId: string,
    status: 'created' | 'active' | 'paused' | 'ended',
    durationSeconds?: number,
    endedAt?: number
  ): void {
    let sql = 'UPDATE sessions SET status = ?';
    const params: (string | number)[] = [status];

    if (durationSeconds !== undefined) {
      sql += ', duration_seconds = ?';
      params.push(durationSeconds);
    }
    if (endedAt !== undefined) {
      sql += ', ended_at = ?';
      params.push(endedAt);
    }
    sql += ' WHERE id = ?';
    params.push(sessionId);

    this.db.prepare(sql).run(...params);
  }

  public getSession(sessionId: string): SessionState | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;
    if (!row) return undefined;
    return this.mapSessionRow(row);
  }

  public getSessionByCode(code: string): SessionState | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE code = ?').get(code.toUpperCase().trim()) as any;
    if (!row) return undefined;
    return this.mapSessionRow(row);
  }

  public getAllSessions(): SessionState[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all() as any[];
    return rows.map(r => this.mapSessionRow(r));
  }

  public deleteSession(sessionId: string): boolean {
    this.db.prepare('DELETE FROM transcripts WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM questions WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM answers WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM notes WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM analytics_summaries WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return true;
  }

  private mapSessionRow(row: any): SessionState {
    let profile: ContextProfile | undefined;
    let devices: DeviceInfo[] = [];

    try {
      if (row.profile_json) profile = JSON.parse(row.profile_json);
    } catch {}

    try {
      if (row.devices_json) devices = JSON.parse(row.devices_json);
    } catch {}

    return {
      id: row.id,
      code: row.code,
      title: row.title,
      type: row.type,
      status: row.status,
      createdAt: row.created_at,
      startedAt: row.started_at || undefined,
      endedAt: row.ended_at || undefined,
      durationSeconds: row.duration_seconds || 0,
      answerLength: row.answer_length || 'normal',
      experienceLevel: row.experience_level || 'senior',
      profile,
      devices,
      primaryConnected: devices.some(d => d.role === 'PRIMARY_CAPTURE'),
      micActive: true,
      systemAudioActive: true,
    };
  }

  // --- Transcripts Methods ---

  public saveTranscript(transcript: TranscriptItem): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO transcripts (
        id, session_id, speaker, text, is_final, confidence, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      transcript.id,
      transcript.sessionId,
      transcript.speaker,
      transcript.text,
      transcript.isFinal ? 1 : 0,
      transcript.confidence ?? 1.0,
      transcript.timestamp
    );
  }

  public getTranscripts(sessionId: string): TranscriptItem[] {
    const rows = this.db.prepare('SELECT * FROM transcripts WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId) as any[];
    return rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      speaker: r.speaker as 'YOU' | 'OTHER',
      text: r.text,
      isFinal: Boolean(r.is_final),
      confidence: r.confidence,
      timestamp: r.timestamp,
    }));
  }

  // --- Questions Methods ---

  public saveQuestion(question: DetectedQuestion): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO questions (
        id, session_id, transcript_id, question_text, category, confidence, context_summary, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      question.id,
      question.sessionId,
      question.transcriptId || null,
      question.questionText,
      question.type,
      question.confidence,
      question.contextSummary || null,
      question.timestamp
    );
  }

  public getQuestions(sessionId: string): DetectedQuestion[] {
    const rows = this.db.prepare('SELECT * FROM questions WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId) as any[];
    return rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      transcriptId: r.transcript_id || undefined,
      questionText: r.question_text,
      type: r.category as QuestionCategory,
      confidence: r.confidence,
      contextSummary: r.context_summary || undefined,
      timestamp: r.timestamp,
    }));
  }

  // --- Answers & Coding Solutions Methods ---

  public saveAnswer(answer: GeneratedAnswer): void {
    const stmt = this.db.prepare(`
      INSERT INTO answers (
        id, question_id, session_id, question_text, direct_answer,
        key_points_json, code_snippet, follow_ups_json, full_content,
        is_complete, length_mode, model, context_used_json,
        first_token_latency_ms, total_latency_ms, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        direct_answer = excluded.direct_answer,
        key_points_json = excluded.key_points_json,
        code_snippet = excluded.code_snippet,
        follow_ups_json = excluded.follow_ups_json,
        full_content = excluded.full_content,
        is_complete = excluded.is_complete,
        first_token_latency_ms = excluded.first_token_latency_ms,
        total_latency_ms = excluded.total_latency_ms;
    `);

    stmt.run(
      answer.id,
      answer.questionId,
      answer.sessionId,
      answer.questionText,
      answer.directAnswer,
      JSON.stringify(answer.keyPoints || []),
      answer.exampleOrSnippet || null,
      JSON.stringify(answer.followUpQuestions || []),
      answer.fullContent || '',
      answer.isComplete ? 1 : 0,
      answer.lengthMode,
      answer.model,
      JSON.stringify(answer.contextUsed || []),
      answer.firstTokenLatencyMs || null,
      answer.totalLatencyMs || null,
      answer.timestamp
    );
  }

  public getAnswers(sessionId: string): GeneratedAnswer[] {
    const rows = this.db.prepare('SELECT * FROM answers WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId) as any[];
    return rows.map(r => this.mapAnswerRow(r));
  }

  private mapAnswerRow(r: any): GeneratedAnswer {
    let keyPoints: string[] = [];
    let followUpQuestions: string[] = [];
    let contextUsed: string[] = [];

    try { keyPoints = JSON.parse(r.key_points_json || '[]'); } catch {}
    try { followUpQuestions = JSON.parse(r.follow_ups_json || '[]'); } catch {}
    try { contextUsed = JSON.parse(r.context_used_json || '[]'); } catch {}

    return {
      id: r.id,
      questionId: r.question_id,
      sessionId: r.session_id,
      questionText: r.question_text,
      directAnswer: r.direct_answer,
      keyPoints,
      exampleOrSnippet: r.code_snippet || undefined,
      followUpQuestions,
      fullContent: r.full_content,
      isComplete: Boolean(r.is_complete),
      lengthMode: r.length_mode,
      model: r.model,
      contextUsed,
      firstTokenLatencyMs: r.first_token_latency_ms || undefined,
      totalLatencyMs: r.total_latency_ms || undefined,
      timestamp: r.timestamp,
    };
  }

  // --- Session Notes Methods ---

  public saveNote(note: SessionNote): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO notes (
        id, session_id, question_id, text, timestamp
      ) VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      note.id,
      note.sessionId,
      note.questionId || null,
      note.text,
      note.timestamp
    );
  }

  public getNotes(sessionId: string): SessionNote[] {
    const rows = this.db.prepare('SELECT * FROM notes WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId) as any[];
    return rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      questionId: r.question_id || undefined,
      text: r.text,
      timestamp: r.timestamp,
    }));
  }

  // --- Analytics & Summaries Methods ---

  public saveSummary(summary: PostSessionSummary): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO analytics_summaries (
        session_id, duration_seconds, total_questions, avg_response_latency_ms,
        topics_discussed_json, topics_to_review_json, questions_summary_json,
        notes_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      summary.sessionId,
      summary.durationSeconds,
      summary.totalQuestions,
      summary.avgResponseLatencyMs,
      JSON.stringify(summary.topicsDiscussed),
      JSON.stringify(summary.topicsToReview),
      JSON.stringify(summary.questions),
      summary.notesCount,
      Date.now()
    );
  }

  public getSummary(sessionId: string): PostSessionSummary | undefined {
    const row = this.db.prepare('SELECT * FROM analytics_summaries WHERE session_id = ?').get(sessionId) as any;
    if (!row) return undefined;

    let topicsDiscussed: string[] = [];
    let topicsToReview: string[] = [];
    let questions: any[] = [];

    try { topicsDiscussed = JSON.parse(row.topics_discussed_json); } catch {}
    try { topicsToReview = JSON.parse(row.topics_to_review_json); } catch {}
    try { questions = JSON.parse(row.questions_summary_json); } catch {}

    return {
      sessionId: row.session_id,
      durationSeconds: row.duration_seconds,
      totalQuestions: row.total_questions,
      avgResponseLatencyMs: row.avg_response_latency_ms,
      topicsDiscussed,
      topicsToReview,
      questions,
      notesCount: row.notes_count,
    };
  }

  // --- Global Analytics & Debugging Methods (PRD & Result Analysis) ---

  public getGlobalAnalytics(): GlobalAnalytics {
    const totalSessions = (this.db.prepare('SELECT COUNT(*) as c FROM sessions').get() as any).c;
    const totalQuestions = (this.db.prepare('SELECT COUNT(*) as c FROM questions').get() as any).c;
    const totalTranscripts = (this.db.prepare('SELECT COUNT(*) as c FROM transcripts').get() as any).c;
    const totalAnswers = (this.db.prepare('SELECT COUNT(*) as c FROM answers').get() as any).c;
    const totalDuration = (this.db.prepare('SELECT SUM(duration_seconds) as s FROM sessions').get() as any).s || 0;

    const avgLatRow = this.db.prepare('SELECT AVG(first_token_latency_ms) as a FROM answers WHERE first_token_latency_ms IS NOT NULL').get() as any;
    const avgLatencyMs = Math.round(avgLatRow?.a || 0);

    // Questions by category
    const catRows = this.db.prepare('SELECT category, COUNT(*) as count FROM questions GROUP BY category').all() as any[];
    const questionsByCategory: Record<string, number> = {};
    catRows.forEach(r => {
      questionsByCategory[r.category] = r.count;
    });

    // Answers by model
    const modelRows = this.db.prepare('SELECT model, COUNT(*) as count FROM answers GROUP BY model').all() as any[];
    const answersByModel: Record<string, number> = {};
    modelRows.forEach(r => {
      answersByModel[r.model] = r.count;
    });

    return {
      totalSessions,
      totalQuestions,
      totalTranscripts,
      totalAnswers,
      avgLatencyMs,
      questionsByCategory,
      answersByModel,
      totalDurationSeconds: totalDuration,
    };
  }

  /**
   * Retrieves all coding questions, architectural blueprints, and algorithmic solutions
   */
  public getAllCodingSolutions(): CodingSolutionItem[] {
    const rows = this.db.prepare(`
      SELECT 
        a.id, a.question_id, a.session_id, a.question_text, 
        q.category, a.direct_answer, a.key_points_json, a.code_snippet, 
        a.full_content, a.model, a.total_latency_ms, a.timestamp
      FROM answers a
      LEFT JOIN questions q ON a.question_id = q.id
      WHERE (q.category = 'Coding' OR q.category = 'System Design' OR (a.code_snippet IS NOT NULL AND a.code_snippet != ''))
      ORDER BY a.timestamp DESC
    `).all() as any[];

    return rows.map(r => {
      let keyPoints: string[] = [];
      try {
        if (r.key_points_json) keyPoints = JSON.parse(r.key_points_json);
      } catch {}

      return {
        questionId: r.question_id,
        sessionId: r.session_id,
        questionText: r.question_text,
        category: r.category || 'Technical',
        directAnswer: r.direct_answer,
        keyPoints,
        codeSnippet: r.code_snippet,
        fullContent: r.full_content,
        model: r.model,
        totalLatencyMs: r.total_latency_ms || 0,
        timestamp: r.timestamp,
      };
    });
  }

  /**
   * Search across all stored questions, answers, and transcripts for debugging or review
   */
  public searchArchive(query: string): {
    questions: DetectedQuestion[];
    answers: GeneratedAnswer[];
  } {
    const searchPattern = `%${query.trim().toLowerCase()}%`;

    const qRows = this.db.prepare(`
      SELECT * FROM questions 
      WHERE LOWER(question_text) LIKE ? 
      ORDER BY timestamp DESC LIMIT 25
    `).all(searchPattern) as any[];

    const aRows = this.db.prepare(`
      SELECT * FROM answers 
      WHERE LOWER(question_text) LIKE ? OR LOWER(direct_answer) LIKE ? OR LOWER(full_content) LIKE ? 
      ORDER BY timestamp DESC LIMIT 25
    `).all(searchPattern, searchPattern, searchPattern) as any[];

    return {
      questions: qRows.map(r => ({
        id: r.id,
        sessionId: r.session_id,
        transcriptId: r.transcript_id || undefined,
        questionText: r.question_text,
        type: r.category as QuestionCategory,
        confidence: r.confidence,
        contextSummary: r.context_summary || undefined,
        timestamp: r.timestamp,
      })),
      answers: aRows.map(r => this.mapAnswerRow(r)),
    };
  }

  /**
   * Complete session debug dump for deep retrospective analysis
   */
  public getSessionDebugDump(sessionId: string): SessionDebugDump {
    const session = this.getSession(sessionId) || null;
    const transcripts = this.getTranscripts(sessionId);
    const questions = this.getQuestions(sessionId);
    const answers = this.getAnswers(sessionId);
    const notes = this.getNotes(sessionId);
    const summary = this.getSummary(sessionId) || null;

    return {
      session,
      transcripts,
      questions,
      answers,
      notes,
      summary,
      exportedAt: Date.now(),
    };
  }
}
