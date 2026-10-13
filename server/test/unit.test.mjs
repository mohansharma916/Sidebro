import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QuestionDetector } from '../dist/questionDetector.js';
import { AIEngine, ThinkFilter } from '../dist/aiEngine.js';
import { ContextEngine, DEMO_PROFILE_ID } from '../dist/contextEngine.js';
import { isAllowedOrigin } from '../dist/common/origin.js';
import { RateLimiter } from '../dist/common/rate-limiter.js';
import { cleanText, oneOf, sanitizeDevice, sanitizeProfile, MODIFIERS } from '../dist/common/validation.js';

const transcript = (speaker, text, id = Math.random().toString(36).slice(2)) => ({
  id, sessionId: 's1', speaker, text, isFinal: true, timestamp: Date.now(),
});

test('QuestionDetector filters greetings and small talk', () => {
  const qd = new QuestionDetector(() => {});
  for (const g of ['Hello hi are you', 'hello how are you', 'hi can you hear me?', 'good morning', 'mic check']) {
    assert.equal(qd.analyzeQuestion(g).isQuestion, false, g);
  }
});

test('QuestionDetector detects and classifies real questions', () => {
  const qd = new QuestionDetector(() => {});
  const r = qd.analyzeQuestion('Tell me about a time you had a conflict with a teammate');
  assert.equal(r.isQuestion, true);
  assert.equal(r.category, 'Behavioral');
  assert.equal(qd.analyzeQuestion('What is idempotency in APIs?').isQuestion, true);
});

test('QuestionDetector ignores the candidate (YOU) speaker', async () => {
  const detected = [];
  const qd = new QuestionDetector(q => detected.push(q));
  qd.ingestTranscript(transcript('YOU', 'Can you repeat what the caching strategy question was?'));
  await new Promise(r => setTimeout(r, 2300));
  qd.clearSession('s1');
  assert.equal(detected.length, 0);
});

test('QuestionDetector flushes the interviewer buffer when the candidate starts talking', () => {
  const detected = [];
  const qd = new QuestionDetector(q => detected.push(q));
  qd.ingestTranscript(transcript('OTHER', 'How does the React Fiber reconciliation work?'));
  qd.ingestTranscript(transcript('YOU', 'Sure, so'));
  qd.clearSession('s1');
  assert.equal(detected.length, 1);
  assert.equal(detected[0].questionText, 'How does the React Fiber reconciliation work?');
});

test('parseStructuredSections extracts all sections', () => {
  const ai = new AIEngine();
  const parsed = ai.parseStructuredSections(
    '### Direct Answer\nUse a hash map.\n\n### Key Points\n• **Fast** lookups\n- Simple\n\n' +
    '### Code / Implementation Blueprint\n```python\nprint(1)\n```\n\n### Anticipated Follow-up Questions\n1. Why?\n2. How?'
  );
  assert.equal(parsed.directAnswer, 'Use a hash map.');
  assert.deepEqual(parsed.keyPoints, ['**Fast** lookups', 'Simple']);
  assert.equal(parsed.exampleOrSnippet, 'print(1)');
  assert.deepEqual(parsed.followUpQuestions, ['Why?', 'How?']);

  // Meta-commentary sanitization
  const metaParsed = ai.parseStructuredSections(
    '### Direct Answer\nThe interviewer is asking about the call, apply, and bind methods in JavaScript, which are used to explicitly set the this context for a function when it is invoked.\n\n### Key Points\n• Call executes immediately'
  );
  assert.equal(
    metaParsed.directAnswer,
    'Call, apply, and bind methods in JavaScript are used to explicitly set the this context for a function when it is invoked.'
  );
});

test('ThinkFilter strips reasoning blocks split across chunks', () => {
  const f = new ThinkFilter();
  const out = ['Hello <th', 'ink>secret', ' reasoning</thi', 'nk> world', ' <', 'b>'].map(c => f.push(c)).join('') + f.flush();
  assert.equal(out, 'Hello  world <b>');
});

test('offline answers never invent first-person experience', async () => {
  // AIEngine reads provider keys at construction time; build it with no keys set.
  const saved = { GROQ_API_KEY: process.env.GROQ_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const ai = new AIEngine();
  for (const [key, value] of Object.entries(saved)) {
    if (value !== undefined) process.env[key] = value;
  }

  for (const [text, type] of [
    ['Tell me about a time you faced a challenge', 'Behavioral'],
    ['What is the time complexity of quicksort?', 'Coding'],
    ['How did you improve performance in your last role?', 'Experience'],
  ]) {
    let completed;
    await ai.streamAnswer(
      { id: 'q', sessionId: 's', questionText: text, type, confidence: 1, timestamp: Date.now() },
      'technical', 'quick', [], [],
      { onStart() {}, onToken() {}, onComplete(a) { completed = a; }, onError() {} }
    );
    assert.match(completed.model, /offline/);
    assert.doesNotMatch(completed.fullContent, /Black Friday|I improved|42%|I led/i, text);
    assert.equal(completed.isComplete, true);
  }
});

test('ContextEngine never falls back to the demo profile', () => {
  const ctx = new ContextEngine();
  assert.ok(ctx.getProfile(DEMO_PROFILE_ID), 'demo profile is seeded for the simulator');
  assert.deepEqual(ctx.retrieveContext(undefined, 'Tell me about a production incident'), []);

  const mine = {
    id: 'mine', name: 'Me', role: 'Engineer', experience: '3y',
    resumeText: 'Built a Kafka ingestion pipeline handling payment events at Acme Corp.',
    jobDescriptionText: '', projectNotesText: '',
  };
  const hits = ctx.retrieveContext(mine, 'Have you worked with Kafka?');
  assert.equal(hits.length, 1);
  assert.match(hits[0].chunk.content, /Kafka/);
});

test('isAllowedOrigin allows local/LAN origins and blocks others', () => {
  for (const o of [undefined, 'http://localhost:5173', 'http://127.0.0.1:3001', 'http://192.168.1.10:5173', 'http://10.0.0.2', 'http://172.20.1.1']) {
    assert.equal(isAllowedOrigin(o), true, String(o));
  }
  for (const o of ['https://evil.example', 'http://172.32.0.1', 'null', 'file://']) {
    assert.equal(isAllowedOrigin(o), false, o);
  }
});

test('RateLimiter enforces its limit per key', () => {
  const rl = new RateLimiter(2, 60_000);
  assert.equal(rl.allow('a'), true);
  assert.equal(rl.allow('a'), true);
  assert.equal(rl.allow('a'), false);
  assert.equal(rl.allow('b'), true);
});

test('validation helpers', () => {
  assert.equal(oneOf('star', MODIFIERS), 'star');
  assert.equal(oneOf('rm -rf', MODIFIERS), undefined);
  assert.equal(cleanText('  hi  ', 10), 'hi');
  assert.equal(cleanText('   ', 10), undefined);
  assert.equal(cleanText('x'.repeat(20), 5), 'xxxxx');
  assert.equal(sanitizeDevice({ id: '../../etc' }), undefined);
  assert.equal(sanitizeDevice({ id: 'phone-1', role: 'ADMIN' }).role, 'SECOND_SCREEN');
  assert.equal(sanitizeProfile({ name: 'no id' }), undefined);
});
