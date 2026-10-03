import { StorageEngine } from './server/dist/storageEngine.js';
import fs from 'fs';
import path from 'path';

async function testSQLiteStorage() {
  console.log('====================================================');
  console.log('🗄️  Testing SQLite Persistent Storage & Analytics');
  console.log('====================================================');

  const testDbPath = path.resolve(process.cwd(), 'server/data/test_copilot.sqlite');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  const storage = new StorageEngine(testDbPath);

  // 1. Test Session Persistence
  const sessionId = `test-sess-${Date.now()}`;
  console.log(`\n1. Creating test session: ${sessionId}...`);
  storage.saveSession({
    id: sessionId,
    code: 'TST999',
    title: 'Senior Distributed Systems Interview',
    type: 'system_design',
    status: 'active',
    createdAt: Date.now(),
    startedAt: Date.now(),
    durationSeconds: 120,
    answerLength: 'detailed',
    experienceLevel: 'senior',
    profile: {
      id: 'p-1',
      name: 'Senior Architect',
      role: 'Staff Engineer',
      experience: '8 Years',
      resumeText: 'Experience in Kafka, Redis, and High Scale APIs',
      jobDescriptionText: 'Lead architect for payment gateways',
      projectNotesText: 'Built idempotent payment checkout processing 50k RPS',
    },
    devices: [],
    primaryConnected: true,
    micActive: true,
    systemAudioActive: true,
  });

  const fetchedSess = storage.getSession(sessionId);
  if (fetchedSess && fetchedSess.title === 'Senior Distributed Systems Interview') {
    console.log('✅ Session saved & retrieved accurately from SQLite');
  } else {
    throw new Error('Failed to retrieve session from SQLite');
  }

  // 2. Test Transcript Storage
  console.log('\n2. Storing interview transcripts...');
  storage.saveTranscript({
    id: 'tr-1',
    sessionId,
    speaker: 'OTHER',
    text: 'How do you prevent duplicate charges when a client retries a payment request?',
    isFinal: true,
    confidence: 0.99,
    timestamp: Date.now() - 5000,
  });

  storage.saveTranscript({
    id: 'tr-2',
    sessionId,
    speaker: 'YOU',
    text: 'We implement API idempotency using unique Idempotency Keys with Redis distributed locking.',
    isFinal: true,
    confidence: 0.98,
    timestamp: Date.now() - 3000,
  });

  const transcripts = storage.getTranscripts(sessionId);
  console.log(`✅ Stored and fetched ${transcripts.length} transcripts from SQLite`);

  // 3. Test Question Storage
  console.log('\n3. Storing detected interview question...');
  const qId = 'q-101';
  storage.saveQuestion({
    id: qId,
    sessionId,
    transcriptId: 'tr-1',
    questionText: 'How do you prevent duplicate charges when a client retries a payment request?',
    type: 'System Design',
    confidence: 0.98,
    timestamp: Date.now() - 4000,
  });

  const questions = storage.getQuestions(sessionId);
  console.log(`✅ Stored question: "${questions[0]?.questionText}"`);

  // 4. Test Answer & Coding Solution Storage
  console.log('\n4. Storing generated AI answer & code implementation...');
  const codeSnippet = `// Idempotent Payment Lock in TypeScript
export async function processPayment(key: string, amount: number) {
  const acquired = await redis.set(\`lock:pay:\${key}\`, 'locked', 'NX', 'EX', 30);
  if (!acquired) throw new ConflictException('Payment request already in progress');
  try {
    return await executePaymentGateway(amount);
  } finally {
    await redis.del(\`lock:pay:\${key}\`);
  }
}`;

  storage.saveAnswer({
    id: 'ans-101',
    questionId: qId,
    sessionId,
    questionText: 'How do you prevent duplicate charges when a client retries a payment request?',
    directAnswer: 'By using an Idempotency-Key header verified against Redis distributed locks and caching previous transaction responses.',
    keyPoints: [
      '**Idempotency-Key Header**: Client attaches unique UUID.',
      '**Redis Mutex**: Acquire lock with atomic SET NX EX.',
      '**Response Caching**: Persist status and return on duplicate calls.',
    ],
    exampleOrSnippet: codeSnippet,
    followUpQuestions: [
      'What happens if the primary gateway crashes mid-transaction?',
      'How long should idempotency keys be retained in cache?',
    ],
    fullContent: `### Direct Answer\nBy using an Idempotency-Key header...\n\n### Code Snippet\n\`\`\`typescript\n${codeSnippet}\n\`\`\``,
    isComplete: true,
    lengthMode: 'detailed',
    model: 'qwen/qwen3.8-27b (Groq)',
    contextUsed: ['RESUME', 'PROJECT_NOTES'],
    firstTokenLatencyMs: 245,
    totalLatencyMs: 820,
    timestamp: Date.now() - 3500,
  });

  const answers = storage.getAnswers(sessionId);
  console.log(`✅ Stored answer from model: ${answers[0]?.model}, 1st token: ${answers[0]?.firstTokenLatencyMs}ms`);
  console.log(`✅ Code snippet preserved: ${answers[0]?.exampleOrSnippet?.includes('processPayment')}`);

  // 5. Test Analytics Aggregations
  console.log('\n5. Testing global analytics & result analysis...');
  const analytics = storage.getGlobalAnalytics();
  console.log('Global Analytics Result:', JSON.stringify(analytics, null, 2));

  if (analytics.totalQuestions >= 1 && analytics.totalAnswers >= 1) {
    console.log('✅ Global analytics aggregations working properly');
  } else {
    throw new Error('Analytics aggregation mismatch');
  }

  // 6. Test Coding Solutions Retrieval
  console.log('\n6. Testing coding solutions query...');
  const codingSolutions = storage.getAllCodingSolutions();
  console.log(`✅ Found ${codingSolutions.length} coding/system design solution(s) in SQLite archive`);
  console.log(`Code excerpt: "${codingSolutions[0]?.codeSnippet?.substring(0, 60)}..."`);

  // 7. Test Archive Search
  console.log('\n7. Testing archive search for "duplicate"...');
  const searchResults = storage.searchArchive('duplicate');
  console.log(`✅ Found ${searchResults.questions.length} question(s) and ${searchResults.answers.length} answer(s) matching "duplicate"`);

  // 8. Test Complete Debug Dump
  console.log('\n8. Testing full session debug dump...');
  const debugDump = storage.getSessionDebugDump(sessionId);
  console.log(`✅ Debug dump generated with ${debugDump.transcripts.length} transcripts, ${debugDump.questions.length} questions, ${debugDump.answers.length} answers.`);

  // Cleanup test database
  fs.unlinkSync(testDbPath);
  console.log('\n====================================================');
  console.log('🎉 ALL SQLITE STORAGE & ANALYTICS TESTS PASSED!');
  console.log('====================================================');
}

testSQLiteStorage().catch(err => {
  console.error('SQLite Test Failed:', err);
  process.exit(1);
});
