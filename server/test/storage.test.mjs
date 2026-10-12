import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { StorageEngine } from '../dist/storageEngine.js';
import { SessionManager } from '../dist/sessionManager.js';

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sidebro-')), 'test.sqlite');

test('DATA_DIR controls where the database is created', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidebro-datadir-'));
  const prev = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    const storage = new StorageEngine();
    storage.close();
    assert.ok(fs.existsSync(path.join(dir, 'copilot.sqlite')));
  } finally {
    if (prev === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prev;
  }
});

test('migrates an old database without the token column', () => {
  const file = tmpDb();
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE sessions (
    id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL,
    created_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER, duration_seconds INTEGER DEFAULT 0,
    answer_length TEXT DEFAULT 'normal', experience_level TEXT DEFAULT 'senior', profile_json TEXT, devices_json TEXT)`);
  old.prepare(`INSERT INTO sessions (id, code, title, type, status, created_at) VALUES ('s-old', 'OLD123', 'Old', 'technical', 'active', 1)`).run();
  old.close();

  const storage = new StorageEngine(file);
  const manager = new SessionManager(storage);
  const s = manager.getSession('s-old');
  assert.ok(s.token, 'old sessions get a token on load');
  assert.equal(s.status, 'paused', 'sessions active at shutdown come back paused');
  assert.equal(storage.getSession('s-old').token, s.token, 'token is persisted');
  manager.shutdown();
  storage.close();
});

test('session lifecycle, lazy history, dedupe and transactional delete', () => {
  const storage = new StorageEngine(tmpDb());
  const manager = new SessionManager(storage);
  const s = manager.createSession('technical', 'T');
  assert.match(s.code, /^[A-Z2-9]{6}$/);
  assert.ok(manager.verifyToken(s.id, s.token));
  assert.equal(manager.verifyToken(s.id, 'wrong'), false);

  const tr = { id: 'tr-1', sessionId: s.id, speaker: 'OTHER', text: 'hi there', isFinal: true, timestamp: Date.now() };
  assert.equal(manager.addTranscript(tr), true);
  assert.equal(manager.addTranscript({ ...tr }), false, 'duplicate id is ignored');

  // A fresh manager loads history lazily from SQLite
  const reloaded = new SessionManager(storage);
  assert.equal(reloaded.getTranscripts(s.id).length, 1);

  manager.endSession(s.id);
  assert.equal(manager.getSessionByCode(s.code), undefined, 'ended session codes stop resolving');
  manager.shutdown();
  assert.equal(storage.getSession(s.id).status, 'ended', 'shutdown does not rewrite ended sessions');

  assert.equal(manager.deleteSession(s.id), true);
  assert.equal(storage.getSession(s.id), undefined);
  assert.equal(storage.getTranscripts(s.id).length, 0);
  reloaded.shutdown();
  storage.close();
});

test('answers upsert and profiles persist', () => {
  const file = tmpDb();
  const storage = new StorageEngine(file);
  const answer = {
    id: 'a1', questionId: 'q1', sessionId: 's1', questionText: 'Q', directAnswer: '', keyPoints: [],
    fullContent: '', isComplete: false, lengthMode: 'normal', model: 'm', timestamp: 1,
  };
  storage.saveAnswer(answer);
  storage.saveAnswer({ ...answer, directAnswer: 'done', keyPoints: ['k'], isComplete: true, fullContent: 'full' });
  const answers = storage.getAnswers('s1');
  assert.equal(answers.length, 1);
  assert.equal(answers[0].directAnswer, 'done');
  assert.deepEqual(answers[0].keyPoints, ['k']);

  storage.saveProfile({ id: 'p1', name: 'Me', role: '', experience: '', resumeText: 'r', jobDescriptionText: '', projectNotesText: '' });
  storage.close();
  const reopened = new StorageEngine(file);
  assert.equal(reopened.getAllProfiles()[0].id, 'p1');
  reopened.close();
});
