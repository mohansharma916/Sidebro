import {
  AnswerLengthMode,
  ContextProfile,
  DeviceInfo,
  DeviceRole,
  DeviceType,
  ExperienceLevel,
  QuestionCategory,
  SessionType,
} from '../types.js';
import type { AnswerModifier } from '../aiEngine.js';

export const SESSION_TYPES: readonly SessionType[] = ['technical', 'behavioral', 'coding', 'system_design', 'sales', 'meeting', 'custom'];
export const EXPERIENCE_LEVELS: readonly ExperienceLevel[] = ['junior', 'mid', 'senior', 'staff'];
export const ANSWER_LENGTHS: readonly AnswerLengthMode[] = ['quick', 'normal', 'detailed'];
export const SPEAKERS = ['YOU', 'OTHER'] as const;
export const MODIFIERS: readonly AnswerModifier[] = ['shorter', 'expand', 'example', 'technical_detail', 'star', 'alternative'];
export const QUESTION_CATEGORIES: readonly QuestionCategory[] = [
  'Technical', 'Coding', 'System Design', 'Behavioral', 'Experience', 'Follow-up', 'Clarification', 'General', 'manual',
];
const DEVICE_TYPES: readonly DeviceType[] = ['CAPTURE', 'WEB', 'MOBILE', 'TABLET'];
const DEVICE_ROLES: readonly DeviceRole[] = ['PRIMARY_CAPTURE', 'SECOND_SCREEN'];

export const MAX_TRANSCRIPT_CHARS = 4000;
export const MAX_QUESTION_CHARS = 1000;
export const MAX_NOTE_CHARS = 4000;
export const MAX_PROFILE_FIELD_CHARS = 50_000;

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;

export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** Trims a string and enforces a max length. Returns undefined for non-strings or empty strings. */
export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function sanitizeDevice(value: unknown): DeviceInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const d = value as Record<string, unknown>;
  if (!isSafeId(d.id)) return undefined;
  return {
    id: d.id,
    name: cleanText(d.name, 100) || 'Unknown device',
    type: oneOf(d.type, DEVICE_TYPES) || 'WEB',
    role: oneOf(d.role, DEVICE_ROLES) || 'SECOND_SCREEN',
    platform: cleanText(d.platform, 100),
    connectedAt: Date.now(),
    lastSeen: Date.now(),
  };
}

export function sanitizeProfile(value: unknown): ContextProfile | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const p = value as Record<string, unknown>;
  if (!isSafeId(p.id)) return undefined;
  const field = (v: unknown, max = MAX_PROFILE_FIELD_CHARS) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    id: p.id,
    name: field(p.name, 200) || 'Untitled profile',
    role: field(p.role, 200),
    experience: field(p.experience, 100),
    resumeText: field(p.resumeText),
    jobDescriptionText: field(p.jobDescriptionText),
    projectNotesText: field(p.projectNotesText),
    preferredLanguage: cleanText(p.preferredLanguage, 50),
  };
}
