import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import dotenv from 'dotenv';
import path from 'path';
import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
} catch { }
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../server/.env') });

import { SessionManager } from './sessionManager.js';
import { QuestionDetector } from './questionDetector.js';
import { ContextEngine } from './contextEngine.js';
import { AIEngine } from './aiEngine.js';
import { MockInterviewer, MOCK_SCENARIOS } from './mockInterviewer.js';
import { SpeechEngine } from './speechEngine.js';
import {
  DetectedQuestion,
  DeviceInfo,
  GeneratedAnswer,
  SessionNote,
  TranscriptItem,
  WSMessage,
} from './types.js';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Core Services
const sessionManager = new SessionManager();
const contextEngine = new ContextEngine();
const aiEngine = new AIEngine();
const speechEngine = new SpeechEngine();

// Helper to determine Local Area Network IP for QR Code scanning
function getLocalNetworkIp(): string {
  const interfaces = os.networkInterfaces();
  for (const ifaceName of Object.keys(interfaces)) {
    const addresses = interfaces[ifaceName];
    if (addresses) {
      for (const addr of addresses) {
        if (addr.family === 'IPv4' && !addr.internal) {
          return addr.address;
        }
      }
    }
  }
  return 'localhost';
}

const localIp = getLocalNetworkIp();

// Map of sessionId -> Set<WebSocket>
const sessionClients: Map<string, Set<WebSocket>> = new Map();
// Map of WebSocket -> { sessionId?: string, deviceId?: string }
const clientMetadata: Map<WebSocket, { sessionId?: string; deviceId?: string }> = new Map();

function broadcastToSession(sessionId: string, message: WSMessage, excludeWs?: WebSocket) {
  const clients = sessionClients.get(sessionId);
  if (!clients || clients.size === 0) {
    console.log(`[WS Broadcast] Note: No active clients in session ${sessionId} for event ${message.event}`);
    return;
  }

  const data = JSON.stringify(message);
  let sentCount = 0;
  for (const client of clients) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(data);
      sentCount++;
    }
  }
  console.log(`[WS Broadcast] Broadcasted ${message.event} to ${sentCount} client(s) in session ${sessionId}`);
}

// Question Detector triggers automatic streaming AI answer
const questionDetector = new QuestionDetector(async (question: DetectedQuestion) => {
  sessionManager.addQuestion(question);

  // Broadcast question detected
  broadcastToSession(question.sessionId, {
    event: 'question.detected',
    sessionId: question.sessionId,
    payload: question,
  });

  await triggerAnswerGeneration(question);
});

// Mock Interviewer for realistic testing & demo
const mockInterviewer = new MockInterviewer((transcript: TranscriptItem) => {
  sessionManager.addTranscript(transcript);
  broadcastToSession(transcript.sessionId, {
    event: 'transcript.final',
    sessionId: transcript.sessionId,
    payload: transcript,
  });
  questionDetector.ingestTranscript(transcript);
});

async function triggerAnswerGeneration(
  question: DetectedQuestion,
  actionModifier?: 'shorter' | 'expand' | 'example' | 'technical_detail' | 'star' | 'alternative'
) {
  const session = sessionManager.getSession(question.sessionId);
  if (!session) return;

  // Retrieve RAG Context
  const relevantChunks = contextEngine.retrieveContext(
    session.profile?.id,
    question.questionText,
    3
  );

  const recentTranscripts = sessionManager.getTranscripts(question.sessionId).slice(-6).map(t => ({
    speaker: t.speaker,
    text: t.text,
  }));

  try {
    await aiEngine.streamAnswer(
      question,
      session.type,
      session.answerLength,
      relevantChunks.map(r => r.chunk),
      recentTranscripts,
      {
        onStart: (answer: GeneratedAnswer) => {
          sessionManager.addOrUpdateAnswer(answer);
          broadcastToSession(question.sessionId, {
            event: 'answer.started',
            sessionId: question.sessionId,
            payload: answer,
          });
        },
        onToken: (token: string, accumulated: string) => {
          broadcastToSession(question.sessionId, {
            event: 'answer.token',
            sessionId: question.sessionId,
            payload: {
              answerId: question.id,
              token,
              accumulated,
            },
          });
        },
        onComplete: (answer: GeneratedAnswer) => {
          sessionManager.addOrUpdateAnswer(answer);
          broadcastToSession(question.sessionId, {
            event: 'answer.completed',
            sessionId: question.sessionId,
            payload: answer,
          });
        },
        onError: (err: any) => {
          broadcastToSession(question.sessionId, {
            event: 'error',
            sessionId: question.sessionId,
            payload: { message: err?.message || 'Error generating answer' },
          });
        },
      },
      actionModifier
    );
  } catch (err) {
    console.error('[Index] Error in triggerAnswerGeneration:', err);
  }
}

// REST Endpoints
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    localIp,
    port: PORT,
  });
});

app.get('/api/network', (req, res) => {
  res.json({
    localIp,
    clientPort: 5173,
    serverPort: PORT,
  });
});

app.post('/api/sessions', (req, res) => {
  const { type, title, profile, experienceLevel } = req.body;
  const session = sessionManager.createSession(type, title, profile, experienceLevel);
  res.json(session);
});

app.get('/api/sessions', (req, res) => {
  res.json(sessionManager.getAllSessions());
});

app.get('/api/sessions/:id', (req, res) => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({
    ...session,
    transcripts: sessionManager.getTranscripts(session.id),
    questions: sessionManager.getQuestions(session.id),
    answers: sessionManager.getAnswers(session.id),
    notes: sessionManager.getNotes(session.id),
    currentQuestion: sessionManager.getCurrentQuestion(session.id),
  });
});

app.get('/api/sessions/code/:code', (req, res) => {
  const session = sessionManager.getSessionByCode(req.params.code);
  if (!session) return res.status(404).json({ error: 'Invalid or expired session code' });
  res.json({
    ...session,
    transcripts: sessionManager.getTranscripts(session.id),
    questions: sessionManager.getQuestions(session.id),
    answers: sessionManager.getAnswers(session.id),
    notes: sessionManager.getNotes(session.id),
    currentQuestion: sessionManager.getCurrentQuestion(session.id),
  });
});

// REST Endpoints for Multi-Device Pairing & Sync (PRD Section 14, 47)
app.post('/api/sessions/:id/devices', (req, res) => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const device: DeviceInfo = req.body;
  if (!device || !device.id) return res.status(400).json({ error: 'Missing device information' });

  sessionManager.addDevice(session.id, device);

  // Broadcast device connection to all active session clients (including Desktop Agent)
  broadcastToSession(session.id, {
    event: 'device.connected',
    sessionId: session.id,
    payload: device,
  });

  console.log(`[REST Device] Device paired successfully: "${device.name}" (${device.role || device.type}) in session ${session.id}. Total devices: ${session.devices.length}`);
  res.json({ success: true, session, devices: session.devices });
});

app.get('/api/sessions/:id/devices', (req, res) => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session.devices || []);
});

app.get('/api/sessions/:id/summary', (req, res) => {
  const summary = sessionManager.generateSummary(req.params.id);
  if (!summary) return res.status(404).json({ error: 'Summary not available' });
  res.json(summary);
});

app.post('/api/sessions/:id/pause', (req, res) => {
  const session = sessionManager.pauseSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  broadcastToSession(req.params.id, {
    event: 'session.paused',
    sessionId: req.params.id,
    payload: { durationSeconds: session.durationSeconds },
  });
  res.json({ success: true, session });
});

app.post('/api/sessions/:id/resume', (req, res) => {
  const session = sessionManager.resumeSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  broadcastToSession(req.params.id, {
    event: 'session.resumed',
    sessionId: req.params.id,
    payload: { durationSeconds: session.durationSeconds },
  });
  res.json({ success: true, session });
});

app.post('/api/sessions/:id/end', (req, res) => {
  const session = sessionManager.endSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  mockInterviewer.stopScenario(req.params.id);
  questionDetector.clearSession(req.params.id);
  const summary = sessionManager.generateSummary(req.params.id);

  broadcastToSession(req.params.id, {
    event: 'session.ended',
    sessionId: req.params.id,
    payload: { summary, durationSeconds: session.durationSeconds },
  });
  res.json({ success: true, session, summary });
});

app.delete('/api/sessions/:id', (req, res) => {
  const success = sessionManager.deleteSession(req.params.id);
  if (!success) return res.status(404).json({ error: 'Session not found' });
  res.json({ success: true, message: 'Session and transcripts permanently deleted (PRD §54).' });
});

// SQLite Analytics, Debugging, and Solutions Archive Endpoints
app.get('/api/analytics/overview', (req, res) => {
  res.json(sessionManager.getStorage().getGlobalAnalytics());
});

app.get('/api/analytics/coding-solutions', (req, res) => {
  res.json(sessionManager.getStorage().getAllCodingSolutions());
});

app.get('/api/analytics/search', (req, res) => {
  const query = (req.query.q as string) || '';
  res.json(sessionManager.getStorage().searchArchive(query));
});

app.get('/api/analytics/debug/:id', (req, res) => {
  const dump = sessionManager.getStorage().getSessionDebugDump(req.params.id);
  if (!dump.session) return res.status(404).json({ error: 'Session not found in SQLite storage' });
  res.json(dump);
});

app.get('/api/analytics/export/:id/markdown', (req, res) => {
  const dump = sessionManager.getStorage().getSessionDebugDump(req.params.id);
  if (!dump.session) return res.status(404).json({ error: 'Session not found' });

  let md = `# Interview Debrief: ${dump.session.title}\n\n`;
  md += `**Date:** ${new Date(dump.session.createdAt).toLocaleString()}\n`;
  md += `**Type:** ${dump.session.type.toUpperCase()} • **Experience Level:** ${dump.session.experienceLevel.toUpperCase()}\n`;
  md += `**Duration:** ${Math.floor(dump.session.durationSeconds / 60)}m ${dump.session.durationSeconds % 60}s\n`;
  md += `**Status:** ${dump.session.status.toUpperCase()}\n\n`;

  if (dump.summary) {
    md += `## Analytics Overview\n`;
    md += `- **Total Questions:** ${dump.summary.totalQuestions}\n`;
    md += `- **Average Latency:** ${dump.summary.avgResponseLatencyMs}ms\n`;
    md += `- **Topics Discussed:** ${dump.summary.topicsDiscussed.join(', ')}\n`;
    md += `- **Topics to Review:** ${dump.summary.topicsToReview.join(', ') || 'None'}\n\n`;
  }

  md += `## Questions & Coding Solutions Log\n\n`;
  dump.questions.forEach((q, idx) => {
    const ans = dump.answers.find(a => a.questionId === q.id);
    md += `### ${idx + 1}. [${q.type}] ${q.questionText}\n`;
    if (ans) {
      md += `**Model:** \`${ans.model}\` • **1st Token:** ${ans.firstTokenLatencyMs || 0}ms • **Total Latency:** ${ans.totalLatencyMs || 0}ms\n\n`;
      md += `#### Direct Answer\n${ans.directAnswer}\n\n`;
      if (ans.keyPoints && ans.keyPoints.length > 0) {
        md += `#### Key Points\n`;
        ans.keyPoints.forEach(p => { md += `• ${p}\n`; });
        md += `\n`;
      }
      if (ans.exampleOrSnippet) {
        md += `#### Code / Implementation Blueprint\n\`\`\`typescript\n${ans.exampleOrSnippet}\n\`\`\`\n\n`;
      }
      if (ans.followUpQuestions && ans.followUpQuestions.length > 0) {
        md += `#### Anticipated Follow-up Questions\n`;
        ans.followUpQuestions.forEach((f, fIdx) => { md += `${fIdx + 1}. ${f}\n`; });
        md += `\n`;
      }
    } else {
      md += `*No answer recorded for this question.*\n\n`;
    }
  });

  if (dump.notes.length > 0) {
    md += `## Saved Notes\n\n`;
    dump.notes.forEach(n => {
      md += `- [${new Date(n.timestamp).toLocaleTimeString()}] ${n.text}\n`;
    });
    md += `\n`;
  }

  if (dump.transcripts.length > 0) {
    md += `## Raw Conversation Transcript\n\n`;
    dump.transcripts.forEach(t => {
      md += `**${t.speaker}** (${new Date(t.timestamp).toLocaleTimeString()}): ${t.text}\n\n`;
    });
  }

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="interview-${dump.session.id}.md"`);
  res.send(md);
});

app.get('/api/profiles', (req, res) => {
  res.json(contextEngine.getAllProfiles());
});

app.post('/api/profiles', (req, res) => {
  contextEngine.saveProfile(req.body);
  res.json({ success: true, profile: req.body });
});

app.get('/api/simulation/scenarios', (req, res) => {
  res.json(MOCK_SCENARIOS);
});

app.post('/api/simulation/start', (req, res) => {
  const { sessionId, scenarioId } = req.body;
  mockInterviewer.startScenario(sessionId, scenarioId);
  res.json({ success: true });
});

app.post('/api/simulation/stop', (req, res) => {
  const { sessionId } = req.body;
  mockInterviewer.stopScenario(sessionId);
  res.json({ success: true });
});

// REST Endpoints for Transcripts & Direct Ingestion (PRD §27 & §54)
app.get('/api/sessions/:id/transcripts', (req, res) => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(sessionManager.getTranscripts(req.params.id));
});

app.post('/api/sessions/:id/transcripts', (req, res) => {
  const sessionId = req.params.id;
  const session = sessionManager.getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const { speaker, text, confidence, isFinal } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Transcript text is required' });
  }

  const transcript: TranscriptItem = {
    id: `tr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    sessionId,
    speaker: speaker === 'YOU' ? 'YOU' : 'OTHER',
    text: text.trim(),
    isFinal: isFinal ?? true,
    timestamp: Date.now(),
    confidence: confidence ?? 0.95,
  };

  sessionManager.addTranscript(transcript);

  broadcastToSession(sessionId, {
    event: 'transcript.final',
    sessionId,
    payload: transcript,
  });

  // Feed into automatic question detection
  questionDetector.ingestTranscript(transcript);

  res.json({ success: true, transcript });
});

app.post('/api/sessions/:id/ask', async (req, res) => {
  const sessionId = req.params.id;
  const session = sessionManager.getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const { questionText, category } = req.body;
  if (!questionText || !questionText.trim()) {
    return res.status(400).json({ error: 'Question text is required' });
  }

  const detected: DetectedQuestion = {
    id: `q-manual-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    sessionId,
    questionText: questionText.trim(),
    type: category || 'General',
    confidence: 1.0,
    timestamp: Date.now(),
  };

  sessionManager.addQuestion(detected);
  broadcastToSession(sessionId, {
    event: 'question.detected',
    sessionId,
    payload: detected,
  });

  await triggerAnswerGeneration(detected);
  res.json({ success: true, question: detected });
});

// Real-Time Audio Chunk Transcription Endpoint (PRD §6 & §7)
app.post('/api/sessions/:id/transcribe-audio', async (req, res) => {
  const sessionId = req.params.id;
  const session = sessionManager.getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'active') {
    return res.json({ success: true, text: '', message: `Session is ${session.status}, audio ignored` });
  }

  const { audioBase64, mimeType = 'audio/webm', speaker = 'OTHER' } = req.body;
  if (!audioBase64) {
    return res.status(400).json({ error: 'audioBase64 is required' });
  }

  try {
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const result = await speechEngine.transcribeAudio(audioBuffer, mimeType);

    if (result.text && result.text.trim()) {
      const transcript: TranscriptItem = {
        id: `tr-audio-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        sessionId,
        speaker: speaker === 'YOU' ? 'YOU' : 'OTHER',
        text: result.text.trim(),
        isFinal: true,
        timestamp: Date.now(),
        confidence: result.confidence,
      };

      sessionManager.addTranscript(transcript);
      broadcastToSession(sessionId, {
        event: 'transcript.final',
        sessionId,
        payload: transcript,
      });

      // Automatically trigger question detection and answer streaming
      questionDetector.ingestTranscript(transcript);
      return res.json({ success: true, text: result.text, transcript, engine: result.engine });
    }

    res.json({ success: true, text: '', message: 'No speech detected in audio slice' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Transcription error' });
  }
});

app.get('/api/settings/stt', (req, res) => {
  res.json(speechEngine.getStatus());
});

app.post('/api/settings/stt', (req, res) => {
  const { provider, apiKey } = req.body;
  if (provider && apiKey) {
    speechEngine.setApiKey(provider, apiKey);
    if (provider === 'openai') {
      aiEngine.setApiKey('openai', apiKey);
    }
  }
  res.json({ success: true, status: speechEngine.getStatus() });
});

// Create HTTP and WebSocket Server
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket, req) => {
  const meta: { sessionId?: string; deviceId?: string } = {};
  clientMetadata.set(ws, meta);

  ws.on('message', async (raw: string) => {
    try {
      const msg: WSMessage = JSON.parse(raw.toString());
      const sessionId = msg.sessionId;

      // Guaranteed room registration: If message has sessionId, ensure ws is tracked in room
      if (sessionId) {
        meta.sessionId = sessionId;
        if (!sessionClients.has(sessionId)) {
          sessionClients.set(sessionId, new Set());
        }
        sessionClients.get(sessionId)?.add(ws);
      }

      switch (msg.event) {
        case 'ping': {
          const curSess = sessionId ? sessionManager.getSession(sessionId) : undefined;
          ws.send(JSON.stringify({
            event: 'pong',
            sessionId,
            payload: { time: Date.now(), durationSeconds: curSess?.durationSeconds },
          }));
          break;
        }

        case 'session.create': {
          const { type, title, profile, experienceLevel } = msg.payload || {};
          const session = sessionManager.createSession(type, title, profile, experienceLevel);
          meta.sessionId = session.id;

          if (!sessionClients.has(session.id)) {
            sessionClients.set(session.id, new Set());
          }
          sessionClients.get(session.id)?.add(ws);

          ws.send(JSON.stringify({
            event: 'session.created',
            sessionId: session.id,
            payload: session,
          }));
          break;
        }

        case 'session.join': {
          const { sessionId, code, device } = msg.payload as {
            sessionId?: string;
            code?: string;
            device: DeviceInfo;
          };

          const session = sessionId
            ? sessionManager.getSession(sessionId)
            : code
              ? sessionManager.getSessionByCode(code)
              : undefined;

          if (!session) {
            ws.send(JSON.stringify({
              event: 'error',
              payload: { message: 'Session not found or invalid code' },
            }));
            return;
          }

          meta.sessionId = session.id;
          meta.deviceId = device.id;

          if (!sessionClients.has(session.id)) {
            sessionClients.set(session.id, new Set());
          }
          sessionClients.get(session.id)?.add(ws);

          sessionManager.addDevice(session.id, device);

          // Reply with joined session state and history
          ws.send(JSON.stringify({
            event: 'session.joined',
            sessionId: session.id,
            payload: {
              session,
              transcripts: sessionManager.getTranscripts(session.id),
              questions: sessionManager.getQuestions(session.id),
              answers: sessionManager.getAnswers(session.id),
              notes: sessionManager.getNotes(session.id),
              currentQuestion: sessionManager.getCurrentQuestion(session.id),
            },
          }));

          // Notify other devices
          broadcastToSession(session.id, {
            event: 'device.connected',
            sessionId: session.id,
            payload: device,
          }, ws);
          break;
        }

        case 'session.update': {
          if (!sessionId) return;
          const { answerLength } = msg.payload || {};
          if (answerLength) {
            sessionManager.updateAnswerLength(sessionId, answerLength);
            broadcastToSession(sessionId, {
              event: 'session.update',
              sessionId,
              payload: { answerLength },
            });
          }
          break;
        }

        case 'audio.status': {
          if (!sessionId) return;
          const { micActive, systemAudioActive } = msg.payload || {};
          sessionManager.setAudioStatus(sessionId, micActive, systemAudioActive);
          broadcastToSession(sessionId, {
            event: 'audio.status',
            sessionId,
            payload: { micActive, systemAudioActive },
          }, ws);
          break;
        }

        case 'transcript.partial': {
          if (!sessionId) return;
          broadcastToSession(sessionId, {
            event: 'transcript.partial',
            sessionId,
            payload: msg.payload,
          }, ws);
          break;
        }

        case 'transcript.final': {
          if (!sessionId) return;
          const transcript: TranscriptItem = {
            id: `tr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            sessionId,
            speaker: msg.payload.speaker || 'OTHER',
            text: msg.payload.text,
            isFinal: true,
            timestamp: Date.now(),
            confidence: msg.payload.confidence ?? 0.95,
          };

          sessionManager.addTranscript(transcript);
          broadcastToSession(sessionId, {
            event: 'transcript.final',
            sessionId,
            payload: transcript,
          });

          // Feed into automatic question detection
          questionDetector.ingestTranscript(transcript);
          break;
        }

        case 'manual.ask': {
          if (!sessionId) return;
          const questionText = msg.payload.questionText;
          if (!questionText) return;

          const detected: DetectedQuestion = {
            id: `q-manual-${Date.now()}`,
            sessionId,
            questionText,
            type: msg.payload.category || 'General',
            confidence: 1.0,
            timestamp: Date.now(),
          };

          sessionManager.addQuestion(detected);
          broadcastToSession(sessionId, {
            event: 'question.detected',
            sessionId,
            payload: detected,
          });

          await triggerAnswerGeneration(detected);
          break;
        }

        case 'action.regenerate': {
          if (!sessionId) return;
          const { questionId, modifier } = msg.payload as {
            questionId: string;
            modifier: 'shorter' | 'expand' | 'example' | 'technical_detail' | 'star' | 'alternative';
          };

          const questions = sessionManager.getQuestions(sessionId);
          const question = questions.find(q => q.id === questionId) || sessionManager.getCurrentQuestion(sessionId);

          if (question) {
            await triggerAnswerGeneration(question, modifier);
          }
          break;
        }

        case 'session.pause': {
          if (!sessionId) return;
          const sess = sessionManager.pauseSession(sessionId);
          broadcastToSession(sessionId, {
            event: 'session.paused',
            sessionId,
            payload: { durationSeconds: sess?.durationSeconds || 0 },
          });
          break;
        }

        case 'session.resume': {
          if (!sessionId) return;
          const sess = sessionManager.resumeSession(sessionId);
          broadcastToSession(sessionId, {
            event: 'session.resumed',
            sessionId,
            payload: { durationSeconds: sess?.durationSeconds || 0 },
          });
          break;
        }

        case 'session.end': {
          if (!sessionId) return;
          const sess = sessionManager.endSession(sessionId);
          mockInterviewer.stopScenario(sessionId);
          questionDetector.clearSession(sessionId);
          const summary = sessionManager.generateSummary(sessionId);

          broadcastToSession(sessionId, {
            event: 'session.ended',
            sessionId,
            payload: { summary, durationSeconds: sess?.durationSeconds || 0 },
          });
          break;
        }

        case 'note.create': {
          if (!sessionId) return;
          const note: SessionNote = {
            id: `note-${Date.now()}`,
            sessionId,
            questionId: msg.payload.questionId,
            text: msg.payload.text,
            timestamp: Date.now(),
          };
          sessionManager.addNote(note);
          broadcastToSession(sessionId, {
            event: 'note.created',
            sessionId,
            payload: note,
          });
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error('[WebSocket] Failed to handle message:', err);
    }
  });

  ws.on('close', () => {
    const meta = clientMetadata.get(ws);
    if (meta && meta.sessionId) {
      const clients = sessionClients.get(meta.sessionId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) {
          sessionClients.delete(meta.sessionId);
        }
      }

      if (meta.deviceId) {
        const curSession = sessionManager.getSession(meta.sessionId);
        const dev = curSession?.devices?.find(d => d.id === meta.deviceId);
        if (dev?.role === 'PRIMARY_CAPTURE') {
          sessionManager.removeDevice(meta.sessionId, meta.deviceId);
          broadcastToSession(meta.sessionId, {
            event: 'device.disconnected',
            sessionId: meta.sessionId,
            payload: { deviceId: meta.deviceId },
          });
        } else {
          // Grace period for mobile / second screen: do not immediately wipe device record
          const targetSessionId = meta.sessionId;
          const targetDeviceId = meta.deviceId;
          setTimeout(() => {
            const recheckSession = sessionManager.getSession(targetSessionId);
            const clients = sessionClients.get(targetSessionId);
            const isClientActive = clients && Array.from(clients).some(c => {
              const clientMeta = clientMetadata.get(c);
              return clientMeta?.deviceId === targetDeviceId;
            });

            if (!isClientActive && recheckSession) {
              sessionManager.removeDevice(targetSessionId, targetDeviceId);
              broadcastToSession(targetSessionId, {
                event: 'device.disconnected',
                sessionId: targetSessionId,
                payload: { deviceId: targetDeviceId },
              });
            }
          }, 45000);
        }
      }
    }
    clientMetadata.delete(ws);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 Real-Time AI Copilot Backend running on:`);
  console.log(`   - Local:   http://localhost:${PORT}`);
  console.log(`   - Network: http://${localIp}:${PORT}`);
  console.log(`   - WebSocket: ws://${localIp}:${PORT}/ws`);
  console.log(`====================================================`);
});
