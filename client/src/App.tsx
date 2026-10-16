import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Laptop,
  Smartphone,
  Sparkles,
  QrCode,
  FileText,
  History,
  Layers,
  HelpCircle,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import {
  AnswerLengthMode,
  ContextProfile,
  DetectedQuestion,
  DeviceInfo,
  ExperienceLevel,
  GeneratedAnswer,
  SessionNote,
  SessionState,
  SessionType,
  TranscriptItem,
  WSMessage,
} from './types';
import { useWebSocket } from './hooks/useWebSocket';
import { newClientId, postJson, setSessionToken } from './api';
import { useAudioCapture } from './hooks/useAudioCapture';
import { DesktopAgentView } from './views/DesktopAgentView';
import { SecondScreenView } from './views/SecondScreenView';
import { JoinSessionView } from './views/JoinSessionView';
import { ContextProfileView } from './views/ContextProfileView';
import { PostSessionView } from './views/PostSessionView';
import { FloatingOverlayView } from './views/FloatingOverlayView';
import { CodingLanes, CodingSource, EMPTY_CODING_LANES } from './components/CodingAnswerPanel';

const isCodingSource = (source: unknown): source is CodingSource => source === 'clipboard' || source === 'screen';

/** Latest answer per coding source, used to restore the coding panels after a join or reload. */
function codingLanesFrom(answers: GeneratedAnswer[] | undefined): CodingLanes {
  const lanes: CodingLanes = { clipboard: { answer: null, status: null }, screen: { answer: null, status: null } };
  for (const a of answers || []) {
    if (isCodingSource(a.source) && (!lanes[a.source].answer || a.timestamp >= lanes[a.source].answer!.timestamp)) {
      lanes[a.source] = { answer: a, status: null };
    }
  }
  return lanes;
}

/** Wide enough to keep code legible, small enough to upload quickly (matches the Electron capture). */
const PASTED_IMAGE_MAX_WIDTH = 1920;

/** Downscales a pasted image and re-encodes it as JPEG; Retina PNG screenshots are otherwise several MB. */
function imageFileToJpegBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, PASTED_IMAGE_MAX_WIDTH / img.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas unavailable'));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unsupported image'));
    };
    img.src = url;
  });
}

/** Appends a streamed token and progressively extracts the direct answer and key points. */
function appendToken(prev: GeneratedAnswer, token: string): GeneratedAnswer {
  const fullContent = (prev.fullContent || '') + token;

  let directAnswer = prev.directAnswer;
  const directMatch = fullContent.match(/### Direct Answer\s*\n([\s\S]*?)(?=\n###|$)/i);
  if (directMatch && directMatch[1].trim()) {
    directAnswer = directMatch[1].trim();
  }

  let keyPoints = prev.keyPoints;
  const keyPointsMatch = fullContent.match(/### Key Points\s*\n([\s\S]*?)(?=\n###|$)/i);
  if (keyPointsMatch && keyPointsMatch[1].trim()) {
    const extracted = keyPointsMatch[1]
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('•') || l.startsWith('-') || l.startsWith('*'))
      .map(l => l.replace(/^[•\-\*]\s*/, '').trim())
      .filter(Boolean);
    if (extracted.length > 0) keyPoints = extracted;
  }

  return { ...prev, fullContent, directAnswer, keyPoints };
}

export function App() {
  // Navigation / Mode state
  const [appMode, setAppMode] = useState<'desktop' | 'second_screen' | 'join' | 'profile' | 'floating'>('desktop');
  const [isStealthProtected, setIsStealthProtected] = useState<boolean>(true);
  const [isElectron, setIsElectron] = useState<boolean>(false);
  const [joinCodeParam, setJoinCodeParam] = useState<string>('');
  const [localIp, setLocalIp] = useState<string>('localhost');

  // Session State
  const [session, setSession] = useState<SessionState | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [questions, setQuestions] = useState<DetectedQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<DetectedQuestion | null>(null);
  const [answers, setAnswers] = useState<Map<string, GeneratedAnswer>>(new Map());
  const [currentAnswer, setCurrentAnswer] = useState<GeneratedAnswer | null>(null);
  // Clipboard and screenshot solutions stream in parallel to the voice answer, one panel each.
  const [codingLanes, setCodingLanes] = useState<CodingLanes>(EMPTY_CODING_LANES);
  const [notes, setNotes] = useState<SessionNote[]>([]);

  // Fetch Network Info (LAN IP for QR scanning from mobile)
  useEffect(() => {
    let active = true;
    const isLoopback = (ip?: string) => !ip || ip === '127.0.0.1' || ip === 'localhost';

    const checkNetwork = () => {
      fetch('/api/network')
        .then(res => res.json())
        .then(data => {
          if (!active) return;
          if (data.localIp) {
            setLocalIp(data.localIp);
          }
        })
        .catch(() => {});
    };

    checkNetwork();
    // Poll every 3 seconds if IP is loopback or not yet loaded, so QR updates automatically when backend/Wi-Fi is ready
    const interval = setInterval(() => {
      if (isLoopback(localIp)) {
        checkNetwork();
      }
    }, 3000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [localIp]);

  // Parse Query Parameters on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('join');
    const mode = params.get('mode');

    if (joinCode) {
      setJoinCodeParam(joinCode);
      setAppMode('join');
    } else if (mode === 'second_screen') {
      setAppMode('join');
    } else if (mode === 'floating') {
      setAppMode('floating');
    } else if (mode === 'desktop') {
      setAppMode('desktop');
    }

    // Connect to Electron floating mode & stealth content protection IPC if in desktop shell
    if (window.electronAPI) {
      setIsElectron(true);
      window.electronAPI.getStealthStatus?.().then(status => {
        if (status) {
          setIsStealthProtected(status.isProtected);
          if (status.isFloating) {
            setAppMode('floating');
          }
        }
      }).catch(() => {});

      window.electronAPI.on('floating-mode-changed', (floating: boolean) => {
        setAppMode(floating ? 'floating' : 'desktop');
      });

      window.electronAPI.on('stealth-status-changed', (info: { isProtected: boolean }) => {
        setIsStealthProtected(info.isProtected);
      });
    }
  }, []);

  // WebSocket Message Handler
  const handleWebSocketMessage = useCallback((msg: WSMessage) => {
    switch (msg.event) {
      case 'session.created': {
        const sess = msg.payload as SessionState;
        setSessionToken(sess.token);
        setSession(sess);
        break;
      }

      case 'session.joined': {
        const { session: sess, transcripts: trs, questions: qs, answers: ansList, notes: nts, currentQuestion: curQ } = msg.payload;
        setSessionToken(sess.token);
        setSession(sess);
        setTranscripts(trs || []);
        setQuestions(qs || []);
        setCurrentQuestion(curQ || null);
        setNotes(nts || []);

        const ansMap = new Map<string, GeneratedAnswer>();
        if (ansList) {
          ansList.forEach((a: GeneratedAnswer) => ansMap.set(a.questionId, a));
          setAnswers(ansMap);
          if (curQ && ansMap.has(curQ.id)) {
            setCurrentAnswer(ansMap.get(curQ.id)!);
          }
        }
        setCodingLanes(codingLanesFrom(ansList));

        // Keep desktop agent in desktop mode; only route to second_screen if not in desktop mode
        setAppMode(prev => prev === 'desktop' ? 'desktop' : 'second_screen');
        break;
      }

      case 'session.update': {
        if (msg.payload.answerLength) {
          setSession(prev => prev ? { ...prev, answerLength: msg.payload.answerLength } : null);
        }
        break;
      }

      case 'device.connected': {
        const dev = msg.payload as DeviceInfo;
        setSession(prev => {
          if (!prev) return null;
          const currentDevices = prev.devices || [];
          const exists = currentDevices.some(d => d.id === dev.id);
          const updatedDevices = exists
            ? currentDevices.map(d => d.id === dev.id ? { ...d, ...dev, lastSeen: Date.now() } : d)
            : [...currentDevices, dev];
          return {
            ...prev,
            devices: updatedDevices,
          };
        });
        break;
      }

      case 'device.disconnected': {
        const { deviceId } = msg.payload;
        setSession(prev => {
          if (!prev) return null;
          const currentDevices = prev.devices || [];
          // Do not delete PRIMARY_CAPTURE, just toggle primaryConnected flag
          const isPrimary = currentDevices.some(d => d.id === deviceId && d.role === 'PRIMARY_CAPTURE');
          if (isPrimary) {
            return { ...prev, primaryConnected: false };
          }
          return {
            ...prev,
            devices: currentDevices.filter(d => d.id !== deviceId),
          };
        });
        break;
      }

      case 'audio.status': {
        const { micActive, systemAudioActive } = msg.payload;
        setSession(prev => prev ? { ...prev, micActive, systemAudioActive } : null);
        break;
      }

      case 'transcript.final': {
        const item = msg.payload as TranscriptItem;
        setTranscripts(prev => {
          // Avoid duplicate display if already added optimistically
          if (prev.some(t => t.id === item.id || (t.text === item.text && Math.abs(t.timestamp - item.timestamp) < 1500))) {
            return prev;
          }
          return [...prev, item];
        });
        break;
      }

      case 'question.detected': {
        const question = msg.payload as DetectedQuestion;
        setQuestions(prev => {
          if (prev.some(q => q.id === question.id)) return prev;
          return [...prev, question];
        });
        // Clipboard/screenshot questions get their own panel; the voice question card stays as it is.
        if (!isCodingSource(question.source)) setCurrentQuestion(question);
        break;
      }

      case 'answer.started': {
        const answer = msg.payload as GeneratedAnswer;
        if (isCodingSource(answer.source)) {
          const source = answer.source;
          setCodingLanes(prev => ({ ...prev, [source]: { answer, status: null } }));
        } else {
          setCurrentAnswer(answer);
        }
        setAnswers(prev => new Map(prev).set(answer.questionId, answer));
        break;
      }

      case 'answer.token': {
        // Tokens are deltas tagged with their answer id; ignore tokens of superseded answers.
        const { answerId, token } = msg.payload as { answerId: string; token: string };
        setCurrentAnswer(prev => (prev && prev.id === answerId ? appendToken(prev, token) : prev));
        setCodingLanes(prev => {
          for (const source of ['clipboard', 'screen'] as const) {
            const lane = prev[source];
            if (lane.answer?.id === answerId) {
              return { ...prev, [source]: { ...lane, answer: appendToken(lane.answer, token) } };
            }
          }
          return prev;
        });
        break;
      }

      case 'answer.completed': {
        const answer = msg.payload as GeneratedAnswer;
        if (isCodingSource(answer.source)) {
          const source = answer.source;
          setCodingLanes(prev => {
            // A different id means a newer answer replaced it; no answer means the panel was dismissed.
            if (prev[source].answer?.id !== answer.id) return prev;
            return { ...prev, [source]: { answer, status: null } };
          });
        } else {
          setCurrentAnswer(prev => (!prev || prev.id === answer.id ? answer : prev));
        }
        setAnswers(prev => {
          const existing = prev.get(answer.questionId);
          if (existing && existing.id !== answer.id && existing.timestamp > answer.timestamp) return prev;
          return new Map(prev).set(answer.questionId, answer);
        });
        break;
      }

      case 'note.created': {
        const note = msg.payload as SessionNote;
        setNotes(prev => [...prev, note]);
        break;
      }

      case 'pong': {
        if (msg.payload?.durationSeconds !== undefined) {
          setSession(prev => prev ? { ...prev, durationSeconds: msg.payload.durationSeconds } : null);
        }
        break;
      }

      case 'session.paused': {
        const dur = msg.payload?.durationSeconds;
        setSession(prev => prev ? { ...prev, status: 'paused', ...(dur !== undefined ? { durationSeconds: dur } : {}) } : null);
        break;
      }

      case 'session.resumed': {
        const dur = msg.payload?.durationSeconds;
        setSession(prev => prev ? { ...prev, status: 'active', ...(dur !== undefined ? { durationSeconds: dur } : {}) } : null);
        break;
      }

      case 'session.ended': {
        const dur = msg.payload?.durationSeconds;
        setSession(prev => prev ? { ...prev, status: 'ended', ...(dur !== undefined ? { durationSeconds: dur } : {}) } : null);
        break;
      }

      default:
        break;
    }
  }, []);

  const sessionRef = useRef<SessionState | null>(session);
  sessionRef.current = session;

  const { latencyMs, send, registerSession, isOpen } = useWebSocket(handleWebSocketMessage);

  // Ingest a final transcript exactly once: over the WebSocket when connected, otherwise via REST.
  // The client-generated id makes the server ignore any duplicate of the same utterance.
  const handleIngestTranscript = useCallback((speaker: 'OTHER' | 'YOU', text: string) => {
    const curSession = sessionRef.current;
    const cleanText = text.trim();
    if (!curSession || !cleanText) return;

    const clientId = newClientId();
    const tempItem: TranscriptItem = {
      id: `tr-${clientId}`,
      sessionId: curSession.id,
      speaker,
      text: cleanText,
      isFinal: true,
      timestamp: Date.now(),
      confidence: 0.98,
    };

    // Optimistic UI update; the server echo has the same id and is de-duplicated
    setTranscripts(prev => (prev.some(t => t.id === tempItem.id) ? prev : [...prev, tempItem]));

    if (isOpen()) {
      send('transcript.final', { speaker, text: cleanText, clientId }, curSession.id);
    } else {
      postJson(`/api/sessions/${curSession.id}/transcripts`, { speaker, text: cleanText, clientId })
        .catch(err => console.warn('[App] Transcript REST ingestion failed:', err));
    }
  }, [send, isOpen]);

  // Audio Chunk Slicing Callback for Cloud / Whisper Transcription
  const handleAudioSlice = useCallback(async (speaker: 'YOU' | 'OTHER', audioBase64: string, mimeType: string) => {
    const curSession = sessionRef.current;
    if (!curSession || !audioBase64) return;
    try {
      const res = await postJson(`/api/sessions/${curSession.id}/transcribe-audio`, { audioBase64, mimeType, speaker });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(`[AudioCapture] Transcribe HTTP ${res.status}:`, errText);
      }
    } catch (err: any) {
      console.warn('[AudioCapture] Transcribe error:', err.message);
    }
  }, []);

  // Audio Capture Hook with both Web Speech API and MediaRecorder chunk streaming
  const {
    state: audioState,
    micRole,
    setMicRole,
    startMicrophone,
    stopMicrophone,
    startSystemAudio,
    stopSystemAudio,
    pauseAudioCapture,
    resumeAudioCapture,
  } = useAudioCapture(
    (speaker, text, isFinal) => {
      if (session && session.status === 'active' && isFinal) {
        handleIngestTranscript(speaker, text);
      }
    },
    (speaker, audioBase64, mimeType) => {
      if (session && session.status === 'active') {
        handleAudioSlice(speaker, audioBase64, mimeType);
      }
    },
    'OTHER'
  );

  // Live 1-second duration clock while session is active
  useEffect(() => {
    if (!session || session.status !== 'active') return;
    const timer = setInterval(() => {
      setSession(prev => {
        if (!prev || prev.status !== 'active') return prev;
        return {
          ...prev,
          durationSeconds: (prev.durationSeconds || 0) + 1,
        };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [session?.status, session?.id]);

  // Sync audio status over WebSocket when state changes
  useEffect(() => {
    if (session) {
      send('audio.status', {
        micActive: audioState.isMicActive,
        systemAudioActive: audioState.isSystemAudioActive,
      }, session.id);
    }
  }, [session?.id, audioState.isMicActive, audioState.isSystemAudioActive, send]);

  // Session Lifecycle Handlers
  const handleCreateSession = async (
    type: SessionType,
    title: string,
    profile: ContextProfile | undefined,
    experienceLevel: ExperienceLevel
  ) => {
    const primaryDev: DeviceInfo = {
      id: 'primary-capture-device',
      name: 'Primary Desktop Agent (Mac/PC)',
      type: 'CAPTURE',
      role: 'PRIMARY_CAPTURE',
      connectedAt: Date.now(),
      lastSeen: Date.now(),
    };

    try {
      const res = await postJson('/api/sessions', { type, title, profile, experienceLevel });
      if (!res.ok) throw new Error(`Session creation failed (HTTP ${res.status})`);
      const newSession: SessionState = await res.json();
      setSessionToken(newSession.token);
      setSession(newSession);
      sessionRef.current = newSession;

      registerSession(newSession.id, newSession.code, primaryDev, newSession.token);
      send('session.join', {
        sessionId: newSession.id,
        token: newSession.token,
        device: primaryDev,
      }, newSession.id);
    } catch (err) {
      console.warn('[App] REST session creation failed, falling back to WebSocket:', err);
      send('session.create', { type, title, profile, experienceLevel });
    }
  };

  const handleJoinSession = async (code: string, device: DeviceInfo) => {
    const cleanCode = code.trim().toUpperCase();
    const res = await fetch(`/api/sessions/code/${encodeURIComponent(cleanCode)}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || 'Session code not found or expired.');
    }

    const data = await res.json();
    setSessionToken(data.token);

    // Register the device via REST (persisted in SQLite and broadcast to the Desktop Agent)
    try {
      const devRes = await postJson(`/api/sessions/${data.id}/devices`, device);
      if (devRes.ok) {
        const devData = await devRes.json();
        if (devData.devices) data.devices = devData.devices;
      }
    } catch (devErr) {
      console.warn('[App] Device pairing REST call failed:', devErr);
    }

    setSession(data);
    sessionRef.current = data;
    setTranscripts(data.transcripts || []);
    setQuestions(data.questions || []);
    setCurrentQuestion(data.currentQuestion || null);
    setNotes(data.notes || []);

    const ansMap = new Map<string, GeneratedAnswer>();
    (data.answers || []).forEach((a: GeneratedAnswer) => ansMap.set(a.questionId, a));
    setAnswers(ansMap);
    if (data.currentQuestion && ansMap.has(data.currentQuestion.id)) {
      setCurrentAnswer(ansMap.get(data.currentQuestion.id)!);
    }
    setCodingLanes(codingLanesFrom(data.answers));

    setAppMode('second_screen');

    // Join the live stream with the session token (also used for automatic reconnects)
    registerSession(data.id, cleanCode, device, data.token);
    send('session.join', { sessionId: data.id, token: data.token, device }, data.id);
  };

  const handlePauseSession = async () => {
    if (!session) return;
    pauseAudioCapture();
    setSession(prev => prev ? { ...prev, status: 'paused' } : null);
    postJson(`/api/sessions/${session.id}/pause`).catch(() => send('session.pause', {}, session.id));
  };

  const handleResumeSession = async () => {
    if (!session) return;
    resumeAudioCapture();
    setSession(prev => prev ? { ...prev, status: 'active' } : null);
    postJson(`/api/sessions/${session.id}/resume`).catch(() => send('session.resume', {}, session.id));
  };

  const handleEndSession = async () => {
    if (!session) return;
    // 1. Immediately shut off hardware mic and system audio recorders
    stopMicrophone();
    stopSystemAudio();
    // 2. Set ended status locally to freeze UI immediately without lag
    setSession(prev => prev ? { ...prev, status: 'ended' } : null);
    // 3. Notify backend (REST; WebSocket only if REST is unreachable)
    try {
      const res = await postJson(`/api/sessions/${session.id}/end`);
      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          setSession(prev => prev ? { ...prev, status: 'ended', durationSeconds: data.session.durationSeconds } : null);
        }
      }
    } catch {
      send('session.end', {}, session.id);
    }
  };

  const handleLengthModeChange = (mode: AnswerLengthMode) => {
    if (session) {
      send('session.update', { answerLength: mode }, session.id);
      setSession({ ...session, answerLength: mode });
    }
  };

  const handleTriggerModifier = (modifier: 'shorter' | 'expand' | 'example' | 'technical_detail' | 'star' | 'alternative') => {
    if (session && currentQuestion) {
      send('action.regenerate', { questionId: currentQuestion.id, modifier }, session.id);
    }
  };

  // In-flight guards: entering stealth mode triggers ensureActiveSessionForStealth from both the
  // toggle handler and the overlay's mount effect. sessionRef is only set after the POST resolves,
  // so without sharing the pending promise each caller creates its own session (and mic stream).
  const sessionCreationRef = useRef<Promise<void> | null>(null);
  const stealthEnsureRef = useRef<Promise<void> | null>(null);

  const ensureLiveSession = async () => {
    const cur = sessionRef.current;
    if (cur && cur.status === 'active') return;
    if (!sessionCreationRef.current) {
      sessionCreationRef.current = handleCreateSession('technical', 'Live Copilot Session', undefined, 'senior')
        .finally(() => { sessionCreationRef.current = null; });
    }
    await sessionCreationRef.current;
  };

  const ensureActiveSessionForStealth = useCallback(() => {
    if (!stealthEnsureRef.current) {
      stealthEnsureRef.current = (async () => {
        await ensureLiveSession();
        if (!audioState.isMicActive) {
          try {
            await startMicrophone();
          } catch (e) {
            console.warn('Auto start mic notice:', e);
          }
        }
      })().finally(() => { stealthEnsureRef.current = null; });
    }
    return stealthEnsureRef.current;
  }, [audioState.isMicActive, startMicrophone]);

  const handleManualAsk = async (questionText: string) => {
    await ensureLiveSession();
    const cur = sessionRef.current;
    if (cur) {
      // REST only (sending manual.ask over the socket too made the server answer twice). It works
      // even before the socket's join completes; the answer still streams back over the socket.
      postJson(`/api/sessions/${cur.id}/ask`, { questionText }).catch(err => {
        console.warn('[App] Manual ask failed:', err);
      });
    }
  };

  const setLaneStatus = (source: CodingSource, status: string | null) =>
    setCodingLanes(prev => ({ ...prev, [source]: { ...prev[source], status } }));

  const dismissCodingLane = useCallback((source: CodingSource) => {
    setCodingLanes(prev => ({ ...prev, [source]: { answer: null, status: null } }));
  }, []);

  // Background copies only go out while a session is running: a stray copy must never start one.
  // An explicit paste into SideBro may start a session, like a typed question does.
  const handleClipboardCopied = async (text: string, explicit = false) => {
    if (explicit) {
      setLaneStatus('clipboard', 'Solving the pasted text…');
      await ensureLiveSession().catch(() => {});
    }
    const cur = sessionRef.current;
    if (!cur || cur.status === 'ended') {
      if (explicit) setLaneStatus('clipboard', '⚠ Start a session first.');
      return;
    }
    try {
      const res = await postJson(`/api/sessions/${cur.id}/solve/clipboard`, { text });
      if (!res.ok) setLaneStatus('clipboard', `⚠ Could not send the copied text (HTTP ${res.status}).`);
    } catch (err: any) {
      setLaneStatus('clipboard', `⚠ Could not send the copied text: ${err.message}`);
    }
  };

  // The screenshot hotkey is an explicit request, so it may start a session like a typed question does.
  const handleScreenshotCaptured = async (imageBase64: string, mimeType: string) => {
    setLaneStatus('screen', 'Reading the screenshot…');
    try {
      await ensureLiveSession();
      const cur = sessionRef.current;
      if (!cur) throw new Error('no active session');
      const res = await postJson(`/api/sessions/${cur.id}/solve/screenshot`, { imageBase64, mimeType });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setLaneStatus('screen', `⚠ ${errData.message || `Screenshot upload failed (HTTP ${res.status}).`}`);
      }
    } catch (err: any) {
      setLaneStatus('screen', `⚠ Screenshot upload failed: ${err.message}`);
    }
  };

  const handleCaptureScreenshot = () => {
    window.electronAPI?.captureScreenshot?.().catch(err => setLaneStatus('screen', `⚠ ${err.message}`));
  };

  // Electron listeners are registered once; the ref always points at this render's handlers.
  const codingHandlersRef = useRef({ handleClipboardCopied, handleScreenshotCaptured, setLaneStatus });
  codingHandlersRef.current = { handleClipboardCopied, handleScreenshotCaptured, setLaneStatus };
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    api.on('clipboard-copied', (data: { text: string }) => {
      void codingHandlersRef.current.handleClipboardCopied(data.text);
    });
    api.on('screenshot-captured', (data: { imageBase64: string; mimeType: string }) => {
      void codingHandlersRef.current.handleScreenshotCaptured(data.imageBase64, data.mimeType);
    });
    api.on('screenshot-error', (data: { message: string }) => {
      codingHandlersRef.current.setLaneStatus('screen', `⚠ ${data.message}`);
    });
  }, []);

  // Browser fallback (Docker / web, where nothing watches the clipboard): Cmd/Ctrl+V anywhere on the
  // page solves pasted text, and a pasted image (e.g. Cmd+Ctrl+Shift+4 screenshot) solves that image.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const data = e.clipboardData;
      if (!data) return;
      const imageItem = Array.from(data.items).find(item => item.kind === 'file' && item.type.startsWith('image/'));
      const file = imageItem?.getAsFile();
      if (file) {
        e.preventDefault();
        codingHandlersRef.current.setLaneStatus('screen', 'Preparing the pasted image…');
        imageFileToJpegBase64(file)
          .then(base64 => codingHandlersRef.current.handleScreenshotCaptured(base64, 'image/jpeg'))
          .catch(err => codingHandlersRef.current.setLaneStatus('screen', `⚠ Could not read the pasted image: ${err.message}`));
        return;
      }
      const text = data.getData('text/plain').trim();
      if (!text) return;
      e.preventDefault();
      void codingHandlersRef.current.handleClipboardCopied(text, true);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const handleSaveNote = (text: string, questionId?: string) => {
    if (session) {
      send('note.create', { text, questionId }, session.id);
    }
  };

  const handleSimulateSpeech = (speaker: 'OTHER' | 'YOU', text: string) => {
    handleIngestTranscript(speaker, text);
  };

  const handleToggleFloatingMode = async () => {
    if (appMode === 'floating') {
      try {
        if (window.electronAPI?.toggleFloatingMode) {
          await window.electronAPI.toggleFloatingMode(false);
        }
      } catch (err) {
        console.warn('[FloatingMode] Electron IPC note:', err);
      }
      setAppMode('desktop');
    } else {
      void ensureActiveSessionForStealth();
      try {
        if (window.electronAPI?.toggleFloatingMode) {
          await window.electronAPI.toggleFloatingMode(true);
        }
      } catch (err) {
        console.warn('[FloatingMode] Electron IPC note:', err);
      }
      setAppMode('floating');
    }
  };

  const handleToggleStealthProtection = async () => {
    const nextVal = !isStealthProtected;
    setIsStealthProtected(nextVal);
    try {
      if (window.electronAPI?.setContentProtection) {
        await window.electronAPI.setContentProtection(nextVal);
      }
    } catch (err) {
      console.warn('[StealthProtection] Electron IPC note:', err);
    }
  };

  // If in Parakeet AI-style Floating Overlay mode, render the compact always-on-top stealth widget
  if (appMode === 'floating') {
    return (
      <FloatingOverlayView
        session={session}
        latencyMs={latencyMs}
        isMicActive={audioState.isMicActive}
        isSystemAudioActive={audioState.isSystemAudioActive}
        micVolume={audioState.micVolume}
        systemVolume={audioState.systemVolume}
        vadActive={audioState.vadActive}
        micRole={micRole}
        transcripts={transcripts}
        questions={questions}
        currentQuestion={currentQuestion}
        currentAnswer={currentAnswer}
        codingLanes={codingLanes}
        onDismissCodingLane={dismissCodingLane}
        onCaptureScreenshot={isElectron ? handleCaptureScreenshot : undefined}
        isProtected={isStealthProtected}
        onToggleProtection={handleToggleStealthProtection}
        onExitFloatingMode={handleToggleFloatingMode}
        onToggleMicrophone={() => (audioState.isMicActive ? stopMicrophone() : startMicrophone())}
        onToggleMicRole={() => setMicRole(micRole === 'OTHER' ? 'YOU' : 'OTHER')}
        onEnsureSession={ensureActiveSessionForStealth}
        onLengthModeChange={handleLengthModeChange}
        onTriggerModifier={handleTriggerModifier}
        onManualAsk={handleManualAsk}
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Universal App Navigation Bar */}
      <header style={{
        background: 'rgba(8, 11, 17, 0.95)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        {/* Brand / Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#051020',
            fontWeight: 800,
          }}>
            <Sparkles size={18} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.01em' }}>
                SIDEBRO <span style={{ color: '#00f2fe' }}>AI</span>
              </span>
              <span style={{
                fontSize: '0.66rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                background: 'rgba(0, 242, 254, 0.12)',
                color: '#00f2fe',
                padding: '2px 6px',
                borderRadius: '4px',
              }}>
                Second-Screen
              </span>
            </div>
            <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
              Your Second-Screen AI Interview Wingman
            </span>
          </div>
        </div>

        {/* Mode Switcher Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => setAppMode('desktop')}
            className={`btn btn-sm ${appMode === 'desktop' ? 'btn-primary' : 'btn-secondary'}`}
            title="Desktop Capture Agent on primary laptop"
          >
            <Laptop size={13} /> Desktop Agent
          </button>

          <button
            onClick={() => {
              if (session) setAppMode('second_screen');
              else setAppMode('join');
            }}
            className={`btn btn-sm ${appMode === 'second_screen' || appMode === 'join' ? 'btn-primary' : 'btn-secondary'}`}
            title="Second Screen AI Workspace on phone or tablet"
          >
            <Smartphone size={13} /> Second Screen
          </button>

          <button
            onClick={() => setAppMode('profile')}
            className={`btn btn-sm ${appMode === 'profile' ? 'btn-primary' : 'btn-secondary'}`}
            title="Resume & Job Description Knowledge Base"
          >
            <FileText size={13} /> Context Profile
          </button>

          {/* Parakeet AI-style Stealth Floating Window Button */}
          <button
            onClick={handleToggleFloatingMode}
            className="btn btn-sm btn-stealth"
            title="Parakeet AI-style Floating Window. Stays pinned on top & 100% invisible to Google Meet, Zoom, and Teams screen sharing."
          >
            <ShieldCheck size={14} /> Stealth Window
          </button>
        </div>
      </header>

      {/* Main Body Routing */}
      <main style={{ flex: 1 }}>
        {appMode === 'desktop' && (
          <DesktopAgentView
            session={session}
            latencyMs={latencyMs}
            localIp={localIp}
            isMicActive={audioState.isMicActive}
            isSystemAudioActive={audioState.isSystemAudioActive}
            micVolume={audioState.micVolume}
            systemVolume={audioState.systemVolume}
            vadActive={audioState.vadActive}
            transcripts={transcripts}
            questions={questions}
            currentQuestion={currentQuestion}
            currentAnswer={currentAnswer}
            codingLanes={codingLanes}
            onDismissCodingLane={dismissCodingLane}
            onStartMicrophone={startMicrophone}
            onStopMicrophone={stopMicrophone}
            onStartSystemAudio={startSystemAudio}
            onStopSystemAudio={stopSystemAudio}
            onCreateSession={handleCreateSession}
            onPauseSession={handlePauseSession}
            onResumeSession={handleResumeSession}
            onEndSession={handleEndSession}
            onSimulateSpeech={handleSimulateSpeech}
            onLaunchFloatingMode={handleToggleFloatingMode}
          />
        )}

        {appMode === 'join' && (
          <JoinSessionView
            initialCode={joinCodeParam || (session ? session.code : '')}
            onJoinSession={handleJoinSession}
          />
        )}

        {appMode === 'second_screen' && (
          session ? (
            <SecondScreenView
              session={session}
              latencyMs={latencyMs}
              transcripts={transcripts}
              questions={questions}
              currentQuestion={currentQuestion}
              currentAnswer={currentAnswer}
              codingLanes={codingLanes}
              onDismissCodingLane={dismissCodingLane}
              notes={notes}
              onLengthModeChange={handleLengthModeChange}
              onTriggerModifier={handleTriggerModifier}
              onManualAsk={handleManualAsk}
              onSaveNote={handleSaveNote}
              onEndSession={handleEndSession}
            />
          ) : (
            <JoinSessionView
              initialCode={joinCodeParam}
              onJoinSession={handleJoinSession}
            />
          )
        )}

        {appMode === 'profile' && (
          <ContextProfileView
            initialProfile={session?.profile}
            onSaveProfile={(prof) => {
              postJson('/api/profiles', prof).catch(err => console.warn('[App] Saving profile failed:', err));
              if (session) {
                setSession({ ...session, profile: prof });
              }
            }}
            onClose={() => setAppMode(session ? 'desktop' : 'join')}
          />
        )}
      </main>
    </div>
  );
}
export default App;
