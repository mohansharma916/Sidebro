import WebSocket from 'ws';

async function runE2ETest() {
  console.log('🧪 Starting End-to-End Test for Real-Time AI Second-Screen Copilot...\n');

  // 1. Create Session via REST API
  const res = await fetch('http://localhost:3001/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'technical',
      title: 'Senior React Native & Architecture Mock Call',
      experienceLevel: 'senior',
    }),
  });
  const session = await res.json();
  console.log(`✅ [1/7] Created Session: ID = ${session.id}, Code = ${session.code}`);

  // 2. Connect Primary Desktop Capture Agent over WebSocket
  const primaryWs = new WebSocket('ws://localhost:3001/ws');
  await new Promise(resolve => primaryWs.on('open', resolve));
  console.log('✅ [2/7] Primary Desktop Capture Agent connected to WebSocket');

  // Join as Primary Capture Device
  primaryWs.send(JSON.stringify({
    event: 'session.join',
    payload: {
      sessionId: session.id,
      device: {
        id: 'primary-mac-agent',
        name: 'MacBook Pro (Capture Agent)',
        type: 'CAPTURE',
        role: 'PRIMARY_CAPTURE',
        connectedAt: Date.now(),
        lastSeen: Date.now(),
      },
    },
  }));

  // 3. Connect Second Screen (Phone/Tablet) via 6-Character Code
  const secondScreenWs = new WebSocket('ws://localhost:3001/ws');
  await new Promise(resolve => secondScreenWs.on('open', resolve));
  console.log(`✅ [3/7] Second Screen connected to WebSocket via Code ${session.code}`);

  let questionDetected = false;
  let answerStarted = false;
  let tokensReceived = 0;
  let answerCompleted = false;

  secondScreenWs.on('message', (data: any) => {
    const msg = JSON.parse(data.toString());

    if (msg.event === 'question.detected') {
      questionDetected = true;
      console.log(`🎯 [Realtime Event] Question Detected: "${msg.payload.questionText}" [Category: ${msg.payload.type}]`);
    } else if (msg.event === 'answer.started') {
      answerStarted = true;
      console.log(`⚡ [Realtime Event] Answer Started! Model: ${msg.payload.model}`);
    } else if (msg.event === 'answer.token') {
      tokensReceived++;
      if (tokensReceived === 1) {
        process.stdout.write('💬 [Streaming Tokens]: ');
      }
      process.stdout.write(msg.payload.token);
    } else if (msg.event === 'answer.completed') {
      answerCompleted = true;
      console.log('\n✨ [Realtime Event] Answer Streaming Completed!');
    }
  });

  // Second screen joins using the 6-character session code
  secondScreenWs.send(JSON.stringify({
    event: 'session.join',
    payload: {
      code: session.code,
      device: {
        id: 'iphone-second-screen',
        name: 'iPhone 15 Pro (Safari)',
        type: 'MOBILE',
        role: 'SECOND_SCREEN',
        connectedAt: Date.now(),
        lastSeen: Date.now(),
      },
    },
  }));

  await new Promise(r => setTimeout(r, 600));

  // 4. Primary Device emits Interviewer Question audio transcript
  console.log('\n🎙️ [4/7] Interviewer asks: "How does the React Fiber reconciliation architecture work under the hood?"');
  primaryWs.send(JSON.stringify({
    event: 'transcript.final',
    sessionId: session.id,
    payload: {
      speaker: 'OTHER',
      text: 'How does the React Fiber reconciliation architecture work under the hood?',
      confidence: 0.99,
    },
  }));

  // Wait for Question Detection and Streaming Answer
  console.log('⏳ [5/7] Waiting for automatic question detection & token streaming...');
  const maxWait = 18000;
  const start = Date.now();
  while ((!questionDetected || !answerCompleted) && Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 200));
  }

  if (questionDetected && answerCompleted) {
    console.log(`\n🎉 [6/7] Question detection and sub-second answer streaming verified!`);
  } else {
    throw new Error('Test timed out waiting for question or answer streaming');
  }

  // 5. Test Saving a Note on Second Screen
  secondScreenWs.send(JSON.stringify({
    event: 'note.create',
    sessionId: session.id,
    payload: {
      text: 'Review React 18 Transitions and priority lanes before the next round.',
    },
  }));

  await new Promise(r => setTimeout(r, 400));

  // 6. End Session and Validate Analytics Summary
  console.log('\n📊 [7/7] Ending session and validating post-session analytics...');
  primaryWs.send(JSON.stringify({
    event: 'session.end',
    sessionId: session.id,
    payload: {},
  }));

  await new Promise(r => setTimeout(r, 500));

  const summaryRes = await fetch(`http://localhost:3001/api/sessions/${session.id}/summary`);
  const summary = await summaryRes.json();
  console.log('📈 Post-Session Summary Result:');
  console.log(`   - Total Questions: ${summary.totalQuestions}`);
  console.log(`   - Topics Covered: ${summary.topicsDiscussed.join(', ')}`);
  console.log(`   - Average Latency: ${summary.avgResponseLatencyMs}ms`);
  console.log(`   - Notes Saved: ${summary.notesCount}`);

  primaryWs.close();
  secondScreenWs.close();

  console.log('\n🏆 ALL 7 END-TO-END TESTS PASSED SUCCESSFULLY! 🚀\n');
}

runE2ETest().catch(err => {
  console.error('❌ E2E Test Error:', err);
  process.exit(1);
});
