// Integration tests: boots the real Nest app in-process on a random port with a temporary
// SQLite directory and no AI provider keys (offline templates), then exercises REST + WebSocket.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import WebSocket from 'ws';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sidebro-api-'));
process.env.CLIENT_DIST = path.join(process.env.DATA_DIR, 'no-client');
for (const key of ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ADMIN_TOKEN']) delete process.env[key];

const { createApp } = await import('../dist/app.js');

let app;
let base;
let wsUrl;

async function start() {
  app = await createApp({ logger: false });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address();
  base = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
}

before(start);
after(async () => {
  await app?.close();
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

function api(pathname, { token, method = 'GET', body, headers = {} } = {}) {
  return fetch(base + pathname, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { 'x-session-token': token } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function createSession(extra = {}) {
  const res = await api('/api/sessions', { method: 'POST', body: { type: 'technical', title: 'Test', ...extra } });
  assert.equal(res.status, 201);
  return res.json();
}

function openWs(headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, headers ? { headers } : undefined);
    ws.msgs = [];
    ws.on('message', m => ws.msgs.push(JSON.parse(m.toString())));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

async function waitFor(fn, timeoutMs = 15000) {
  const startAt = Date.now();
  while (Date.now() - startAt < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(100);
  }
  throw new Error('Timed out waiting for condition');
}

async function joinWithToken(session, device) {
  const ws = await openWs();
  ws.send(JSON.stringify({ event: 'session.join', payload: { sessionId: session.id, token: session.token, device } }));
  await waitFor(() => ws.msgs.some(m => m.event === 'session.joined'));
  return ws;
}

test('session routes require the session token', async () => {
  const s = await createSession();
  assert.ok(s.token);
  assert.equal((await api(`/api/sessions/${s.id}`)).status, 401);
  assert.equal((await api(`/api/sessions/${s.id}`, { token: 'nope' })).status, 401);
  assert.equal((await api(`/api/sessions/${s.id}`, { token: s.token })).status, 200);
  assert.equal((await api(`/api/sessions/${s.id}`, { method: 'DELETE' })).status, 401);
  assert.equal((await api(`/api/analytics/debug/${s.id}`)).status, 401);
  assert.equal((await api(`/api/analytics/export/${s.id}/markdown?token=${s.token}`)).status, 200);
});

test('cross-session endpoints are disabled without ADMIN_TOKEN, and config endpoint is gone', async () => {
  assert.equal((await api('/api/sessions')).status, 403);
  assert.equal((await api('/api/analytics/search?q=a')).status, 403);
  assert.equal((await api('/api/speech/config', { method: 'POST', body: { provider: 'groq', apiKey: 'x' } })).status, 404);
});

test('pairing by code returns the token', async () => {
  const s = await createSession();
  const res = await api(`/api/sessions/code/${s.code.toLowerCase()}`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).token, s.token);
});

test('a socket that has not joined receives nothing from a session', async () => {
  const s = await createSession();
  const owner = await joinWithToken(s);
  const spy = await openWs();
  spy.send(JSON.stringify({ event: 'ping', sessionId: s.id, payload: { time: Date.now() } }));
  spy.send(JSON.stringify({ event: 'session.join', payload: { sessionId: s.id, token: 'guess' } }));
  spy.send(JSON.stringify({ event: 'transcript.final', sessionId: s.id, payload: { speaker: 'OTHER', text: 'spy text' } }));
  await sleep(200);

  owner.send(JSON.stringify({ event: 'transcript.final', payload: { speaker: 'OTHER', text: 'Hello there' } }));
  await waitFor(() => owner.msgs.some(m => m.event === 'transcript.final'));
  await sleep(200);

  const spyEvents = new Set(spy.msgs.map(m => m.event));
  assert.deepEqual([...spyEvents].sort(), ['error', 'pong']);
  const transcripts = await (await api(`/api/sessions/${s.id}/transcripts`, { token: s.token })).json();
  assert.ok(!transcripts.some(t => t.text === 'spy text'), 'unjoined socket cannot write');
  owner.close();
  spy.close();
});

test('WebSocket connections from foreign origins are rejected', async () => {
  const ws = new WebSocket(wsUrl, { headers: { Origin: 'https://evil.example' } });
  const code = await new Promise(resolve => ws.on('close', c => resolve(c)));
  assert.equal(code, 1008);
});

test('CORS does not allow foreign origins', async () => {
  const evil = await api('/api/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const lan = await api('/api/health', { headers: { Origin: 'http://192.168.1.20:5173' } });
  assert.equal(lan.headers.get('access-control-allow-origin'), 'http://192.168.1.20:5173');
});

test('one utterance sent over WS and REST with the same clientId is stored once', async () => {
  const s = await createSession();
  const owner = await joinWithToken(s);
  const text = 'How does the React Fiber reconciliation work?';
  owner.send(JSON.stringify({ event: 'transcript.final', payload: { speaker: 'OTHER', text, clientId: 'utt-1' } }));
  const rest = await api(`/api/sessions/${s.id}/transcripts`, { token: s.token, method: 'POST', body: { speaker: 'OTHER', text, clientId: 'utt-1' } });
  assert.equal((await rest.json()).duplicate, true);

  const q = await waitFor(() => owner.msgs.find(m => m.event === 'question.detected'));
  assert.equal(q.payload.questionText, text);
  const transcripts = await (await api(`/api/sessions/${s.id}/transcripts`, { token: s.token })).json();
  assert.equal(transcripts.length, 1);
  owner.close();
});

test('token deltas carry the real answer id and rebuild the full answer', async () => {
  const s = await createSession();
  const owner = await joinWithToken(s);
  owner.send(JSON.stringify({ event: 'manual.ask', payload: { questionText: 'What is idempotency in APIs?' } }));

  const done = await waitFor(() => owner.msgs.find(m => m.event === 'answer.completed'), 20000);
  const started = owner.msgs.find(m => m.event === 'answer.started');
  const tokens = owner.msgs.filter(m => m.event === 'answer.token');
  assert.ok(tokens.length > 0);
  assert.ok(tokens.every(t => t.payload.answerId === started.payload.id));
  assert.ok(tokens.every(t => t.payload.accumulated === undefined), 'only deltas are sent');
  assert.equal(tokens.map(t => t.payload.token).join(''), done.payload.fullContent);
  owner.close();
});

test('candidate speech does not trigger answers; no-profile answers use no context', async () => {
  const s = await createSession();
  const owner = await joinWithToken(s);
  await api(`/api/sessions/${s.id}/transcripts`, { token: s.token, method: 'POST', body: { speaker: 'YOU', text: 'Can you repeat what the caching strategy question was?' } });
  await sleep(3800);
  assert.equal(owner.msgs.filter(m => m.event === 'question.detected').length, 0);

  await api(`/api/sessions/${s.id}/ask`, { token: s.token, method: 'POST', body: { questionText: 'Tell me about a time you faced a challenge' } });
  const done = await waitFor(() => owner.msgs.find(m => m.event === 'answer.completed'), 20000);
  assert.deepEqual(done.payload.contextUsed, []);
  assert.doesNotMatch(done.payload.fullContent, /Black Friday|I led/);
  owner.close();
});

test('a newer question cancels the in-flight answer', async () => {
  const s = await createSession();
  const owner = await joinWithToken(s);
  owner.send(JSON.stringify({ event: 'manual.ask', payload: { questionText: 'How does React Fiber work?' } }));
  await waitFor(() => owner.msgs.some(m => m.event === 'answer.token'));
  owner.send(JSON.stringify({ event: 'manual.ask', payload: { questionText: 'What is idempotency in APIs?' } }));

  await waitFor(() => owner.msgs.filter(m => m.event === 'answer.completed').length === 2, 20000);
  const [first, second] = owner.msgs.filter(m => m.event === 'answer.completed').map(m => m.payload);
  assert.ok(first.totalLatencyMs < second.totalLatencyMs, 'first answer stopped early');
  owner.close();
});

test('a clipboard solution streams alongside the voice answer without cancelling it', async () => {
  const s = await createSession();
  const owner = await joinWithToken(s);
  const voiceRes = await api(`/api/sessions/${s.id}/ask`, { token: s.token, method: 'POST', body: { questionText: 'How does React Fiber work?' } });
  const voiceQuestion = (await voiceRes.json()).question;
  await waitFor(() => owner.msgs.some(m => m.event === 'answer.token'));

  const clipRes = await api(`/api/sessions/${s.id}/solve/clipboard`, {
    token: s.token,
    method: 'POST',
    body: { text: 'Given an array of integers nums and a target, return indices of the two numbers that add up to target.' },
  });
  assert.equal(clipRes.status, 201);
  const clipQuestion = (await clipRes.json()).question;
  assert.equal(clipQuestion.source, 'clipboard');
  assert.equal(clipQuestion.type, 'Coding');

  await waitFor(() => owner.msgs.filter(m => m.event === 'answer.completed').length === 2, 30000);
  const completed = owner.msgs.filter(m => m.event === 'answer.completed').map(m => m.payload);
  const voice = completed.find(a => a.questionId === voiceQuestion.id);
  const clip = completed.find(a => a.questionId === clipQuestion.id);
  assert.equal(clip.source, 'clipboard');
  assert.match(voice.fullContent, /Offline template/, 'voice answer streamed to the end');

  // The voice flow keeps its own current question; the coding answer is persisted with its source.
  const state = await (await api(`/api/sessions/${s.id}`, { token: s.token })).json();
  assert.equal(state.currentQuestion.id, voiceQuestion.id);
  assert.equal(state.answers.find(a => a.questionId === clipQuestion.id).source, 'clipboard');
  owner.close();
});

test('screenshot solving validates input and explains a missing vision provider', async () => {
  const s = await createSession();
  const owner = await joinWithToken(s);
  const missing = await api(`/api/sessions/${s.id}/solve/screenshot`, { token: s.token, method: 'POST', body: {} });
  assert.equal(missing.status, 400);
  const tooShort = await api(`/api/sessions/${s.id}/solve/clipboard`, { token: s.token, method: 'POST', body: { text: '   ' } });
  assert.equal(tooShort.status, 400);

  const res = await api(`/api/sessions/${s.id}/solve/screenshot`, {
    token: s.token,
    method: 'POST',
    body: { imageBase64: Buffer.from('not really a jpeg').toString('base64'), mimeType: 'image/jpeg' },
  });
  assert.equal(res.status, 201);
  const done = await waitFor(() => owner.msgs.find(m => m.event === 'answer.completed'), 20000);
  assert.equal(done.payload.source, 'screen');
  assert.match(done.payload.directAnswer, /vision-capable/);
  owner.close();
});

test('ended sessions reject new transcripts and their codes stop resolving', async () => {
  const s = await createSession();
  const end = await api(`/api/sessions/${s.id}/end`, { token: s.token, method: 'POST' });
  assert.equal(end.status, 201);
  assert.equal((await api(`/api/sessions/code/${s.code}`)).status, 404);
  const tr = await api(`/api/sessions/${s.id}/transcripts`, { token: s.token, method: 'POST', body: { text: 'late' } });
  assert.equal(tr.status, 409);
});

test('invalid input is rejected', async () => {
  const s = await createSession({ type: 'not-a-type', experienceLevel: 'god' });
  assert.equal(s.type, 'technical');
  assert.equal(s.experienceLevel, 'senior');
  const bad = await api(`/api/sessions/${s.id}/action`, { token: s.token, method: 'POST', body: { questionId: 'x', modifier: 'evil' } });
  assert.equal(bad.status, 400);
  const empty = await api(`/api/sessions/${s.id}/ask`, { token: s.token, method: 'POST', body: { questionText: '   ' } });
  assert.equal(empty.status, 400);
});

test('mock interview endpoints work', async () => {
  const s = await createSession();
  const res = await api(`/api/sessions/${s.id}/mock-interview/start`, { token: s.token, method: 'POST', body: { scenarioId: 'system-design' } });
  assert.equal((await res.json()).scenarioId, 'system-design');
  await api(`/api/sessions/${s.id}/mock-interview/stop`, { token: s.token, method: 'POST' });
});

test('sessions and profiles survive a restart', async () => {
  const s = await createSession();
  const prof = await api('/api/profiles', { method: 'POST', body: { id: 'profile-test', name: 'Me', resumeText: 'Kafka at Acme' } });
  assert.equal(prof.status, 201);

  await app.close();
  await start();

  const res = await api(`/api/sessions/${s.id}`, { token: s.token });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'paused');
  const profiles = await (await api('/api/profiles')).json();
  assert.ok(profiles.some(p => p.id === 'profile-test'));
});
