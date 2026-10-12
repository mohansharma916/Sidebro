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
  const [notes, setNotes] = useState<SessionNote[]>([]);

  // Fetch Network Info (LAN IP for QR scanning from mobile)
  useEffect(() => {
    fetch('/api/network')
      .then(res => res.json())
      .then(data => {
        if (data.localIp) setLocalIp(data.localIp);
      })
      .catch(() => {});
  }, []);

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
        setCurrentQuestion(question);
        break;
      }

      case 'answer.started': {
        const answer = msg.payload as GeneratedAnswer;
        setCurrentAnswer(answer);
        setAnswers(prev => new Map(prev).set(answer.questionId, answer));
        break;
      }

      case 'answer.token': {
        // Tokens are deltas tagged with their answer id; ignore tokens of superseded answers.
        const { answerId, token } = msg.payload as { answerId: string; token: string };
        setCurrentAnswer(prev => {
          if (!prev || prev.id !== answerId) return prev;
          return { ...prev, fullContent: (prev.fullContent || '') + token };
        });
        break;
      }

      case 'answer.completed': {
        const answer = msg.payload as GeneratedAnswer;
        setCurrentAnswer(prev => (!prev || prev.id === answer.id ? answer : prev));
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
    }
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

  const handleManualAsk = (questionText: string) => {
    if (session) {
      send('manual.ask', { questionText }, session.id);
    }
  };

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
        transcripts={transcripts}
        questions={questions}
        currentQuestion={currentQuestion}
        currentAnswer={currentAnswer}
        isProtected={isStealthProtected}
        onToggleProtection={handleToggleStealthProtection}
        onExitFloatingMode={handleToggleFloatingMode}
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
