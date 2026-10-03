import http from 'http';

async function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, res => {
      let buf = '';
      res.on('data', chunk => buf += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(buf));
        } catch {
          resolve(buf);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let buf = '';
      res.on('data', chunk => buf += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(buf));
        } catch {
          resolve(buf);
        }
      });
    }).on('error', reject);
  });
}

async function runTest() {
  console.log('--- Testing Key Points & Coding Example SQLite Storage ---');

  // 1. Create a session via POST /api/sessions
  const session = await postJSON('http://localhost:3001/api/sessions', {
    type: 'System Design',
    title: 'Coding & Key Points Persistence Verification',
    experienceLevel: 'senior',
  });
  console.log('1. Created session:', session.id, 'Code:', session.code);

  // 2. Ask coding question via POST /api/sessions/:id/ask
  const questionText = 'Implement an LRU Cache in TypeScript with O(1) get and put operations using a doubly linked list and hash map.';
  console.log('2. Triggering AI answer stream for question:', questionText);
  const askRes = await postJSON(`http://localhost:3001/api/sessions/${session.id}/ask`, {
    questionText,
    category: 'Coding',
  });
  console.log('Asked question:', askRes.question?.id);

  // Wait 6 seconds for Groq LLM streaming to complete and save to SQLite
  console.log('Waiting for stream completion & SQLite write...');
  await new Promise(r => setTimeout(r, 6500));

  // 3. Query Coding Solutions API
  const codingRes = await getJSON('http://localhost:3001/api/analytics/coding-solutions');
  console.log('\n3. Coding Solutions in SQLite archive count:', codingRes.count);
  const latestSolution = codingRes.solutions?.[0];

  if (latestSolution) {
    console.log('\n[Latest Stored Solution from SQLite]');
    console.log('- Question:', latestSolution.questionText);
    console.log('- Category:', latestSolution.category);
    console.log('- Direct Answer:', latestSolution.directAnswer?.slice(0, 100) + '...');
    console.log('- Key Points Count:', latestSolution.keyPoints?.length);
    console.log('- Key Points List:', latestSolution.keyPoints);
    console.log('- Code Snippet Present:', Boolean(latestSolution.codeSnippet));
    console.log('- Code Snippet Preview:');
    console.log(latestSolution.codeSnippet?.slice(0, 280) + '\n...');
  }

  // 4. Query session debug dump
  const debugDump = await getJSON(`http://localhost:3001/api/analytics/debug/${session.id}`);
  const storedAnswer = debugDump.answers?.[0];

  console.log('\n4. Verified SQLite Stored Record:');
  console.log('- Question ID:', storedAnswer?.questionId);
  console.log('- Direct Answer Stored:', Boolean(storedAnswer?.directAnswer));
  console.log('- Key Points Stored Count:', storedAnswer?.keyPoints?.length);
  console.log('- Code Snippet Stored:', Boolean(storedAnswer?.exampleOrSnippet));
  console.log('- Total Latency (ms):', storedAnswer?.totalLatencyMs);
  console.log('- Model:', storedAnswer?.model);

  if (storedAnswer?.keyPoints?.length > 0 && storedAnswer?.exampleOrSnippet) {
    console.log('\n✅ SUCCESS: Both Key Points and Coding Solutions are stored and parsed into SQLite perfectly!');
  } else {
    console.log('\n⚠️ Check fields:', {
      keyPointsCount: storedAnswer?.keyPoints?.length,
      hasCodeSnippet: Boolean(storedAnswer?.exampleOrSnippet)
    });
  }
}

runTest().catch(console.error);
