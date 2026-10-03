export type SessionType = 
  | 'technical' 
  | 'behavioral' 
  | 'coding' 
  | 'system_design' 
  | 'sales' 
  | 'meeting' 
  | 'custom';

export type ExperienceLevel = 'junior' | 'mid' | 'senior' | 'staff';

export type AnswerLengthMode = 'quick' | 'normal' | 'detailed';

export type QuestionCategory = 
  | 'Technical' 
  | 'Coding' 
  | 'System Design' 
  | 'Behavioral' 
  | 'Experience' 
  | 'Follow-up' 
  | 'Clarification' 
  | 'General';

export type DeviceType = 'CAPTURE' | 'WEB' | 'MOBILE' | 'TABLET';

export type DeviceRole = 'PRIMARY_CAPTURE' | 'SECOND_SCREEN';

export interface DeviceInfo {
  id: string;
  name: string;
  type: DeviceType;
  role: DeviceRole;
  platform?: string;
  connectedAt: number;
  lastSeen: number;
}

export interface ContextProfile {
  id: string;
  name: string;
  role: string;
  experience: string;
  resumeText: string;
  jobDescriptionText: string;
  projectNotesText: string;
  preferredLanguage?: string;
}

export interface SessionState {
  id: string;
  code: string;
  title: string;
  type: SessionType;
  status: 'created' | 'active' | 'paused' | 'ended';
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  durationSeconds: number;
  answerLength: AnswerLengthMode;
  experienceLevel: ExperienceLevel;
  profile?: ContextProfile;
  devices: DeviceInfo[];
  primaryConnected: boolean;
  micActive: boolean;
  systemAudioActive: boolean;
}

export interface TranscriptItem {
  id: string;
  sessionId: string;
  speaker: 'YOU' | 'OTHER';
  text: string;
  isFinal: boolean;
  timestamp: number;
  confidence?: number;
}

export interface DetectedQuestion {
  id: string;
  sessionId: string;
  transcriptId?: string;
  questionText: string;
  type: QuestionCategory;
  confidence: number;
  timestamp: number;
  contextSummary?: string;
}

export interface GeneratedAnswer {
  id: string;
  questionId: string;
  sessionId: string;
  questionText: string;
  directAnswer: string;
  keyPoints: string[];
  exampleOrSnippet?: string;
  followUpQuestions?: string[];
  fullContent: string;
  isComplete: boolean;
  lengthMode: AnswerLengthMode;
  model: string;
  contextUsed?: string[];
  firstTokenLatencyMs?: number;
  totalLatencyMs?: number;
  timestamp: number;
}

export interface SessionNote {
  id: string;
  sessionId: string;
  questionId?: string;
  text: string;
  timestamp: number;
}

export interface PostSessionSummary {
  sessionId: string;
  durationSeconds: number;
  totalQuestions: number;
  topicsDiscussed: string[];
  topicsToReview: string[];
  questions: {
    question: string;
    type: QuestionCategory;
    answerExcerpt: string;
  }[];
  notesCount: number;
  avgResponseLatencyMs: number;
}

export type WSEventType = 
  | 'ping'
  | 'pong'
  | 'session.create'
  | 'session.created'
  | 'session.join'
  | 'session.joined'
  | 'session.update'
  | 'session.pause'
  | 'session.paused'
  | 'session.resume'
  | 'session.resumed'
  | 'session.end'
  | 'session.ended'
  | 'device.connected'
  | 'device.disconnected'
  | 'audio.status'
  | 'transcript.partial'
  | 'transcript.final'
  | 'question.detected'
  | 'answer.started'
  | 'answer.token'
  | 'answer.completed'
  | 'manual.ask'
  | 'action.regenerate'
  | 'note.create'
  | 'note.created'
  | 'error';

export interface WSMessage<T = any> {
  event: WSEventType;
  sessionId?: string;
  deviceId?: string;
  payload: T;
}
