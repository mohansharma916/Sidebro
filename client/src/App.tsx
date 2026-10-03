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
import { useAudioCapture } from './hooks/useAudioCapture';
import { DesktopAgentView } from './views/DesktopAgentView';
import { SecondScreenView } from './views/SecondScreenView';
import { JoinSessionView } from './views/JoinSessionView';
import { ContextProfileView } from './views/ContextProfileView';
import { PostSessionView } from './views/PostSessionView';

export function App() {
  // Navigation / Mode state
  const [appMode, setAppMode] = useState<'desktop' | 'second_screen' | 'join' | 'profile'>('desktop');
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
    } else if (mode === 'desktop') {
      setAppMode('desktop');
    }
  }, []);

  // WebSocket Message Handler
  const handleWebSocketMessage = useCallback((msg: WSMessage) => {
    switch (msg.event) {
      case 'session.created': {
        const sess = msg.payload as SessionState;
        setSession(sess);
        break;
      }

      case 'session.joined': {
        const { session: sess, transcripts: trs, questions: qs, answers: ansList, notes: nts, currentQuestion: curQ } = msg.payload;
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
        const { answerId, token, accumulated } = msg.payload;
        setCurrentAnswer(prev => {
          if (!prev) return null;
          return {
            ...prev,
            fullContent: accumulated,
          };
        });
        break;
      }

      case 'answer.completed': {
        const answer = msg.payload as GeneratedAnswer;
        setCurrentAnswer(answer);
        setAnswers(prev => new Map(prev).set(answer.questionId, answer));
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

  const { isConnected, latencyMs, send, registerSession } = useWebSocket(handleWebSocketMessage);

  // Ingest transcripts optimistically locally, over WebSocket, and via REST for 100% guarantee
  const handleIngestTranscript = useCallback((speaker: 'OTHER' | 'YOU', text: string) => {
    const curSession = sessionRef.current || session;
    if (!curSession || !text.trim()) return;

    const tempItem: TranscriptItem = {
      id: `tr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      sessionId: curSession.id,
      speaker,
      text: text.trim(),
      isFinal: true,
      timestamp: Date.now(),
      confidence: 0.98,
    };

    // 1. Immediate optimistic UI update
    setTranscripts(prev => {
      if (prev.some(t => t.text === tempItem.text && Math.abs(t.timestamp - tempItem.timestamp) < 1000)) {
        return prev;
      }
      return [...prev, tempItem];
    });

    // 2. Real-time WebSocket broadcast to all connected devices
    send('transcript.final', { speaker, text: text.trim() }, curSession.id);

    // 3. Reliable REST backup ingestion (guarantees question detection and DB sync)
    fetch(`/api/sessions/${curSession.id}/transcripts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speaker, text: text.trim(), isFinal: true }),
    }).catch(err => console.warn('[App] Transcript REST ingestion note:', err));
  }, [session, send]);

  // Audio Chunk Slicing Callback for Cloud / Whisper Transcription
  const handleAudioSlice = useCallback(async (speaker: 'YOU' | 'OTHER', audioBase64: string, mimeType: string) => {
    const curSession = sessionRef.current || session;
    if (!curSession || !audioBase64) return;
    try {
      const res = await fetch(`/api/sessions/${curSession.id}/transcribe-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64, mimeType, speaker }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.text) {
          console.log(`[AudioCapture] Successfully transcribed ${speaker} audio: "${data.text}"`);
        }
      } else {
        const errText = await res.text().catch(() => '');
        console.warn(`[AudioCapture] Transcribe HTTP ${res.status}:`, errText);
      }
    } catch (err: any) {
      console.warn('[AudioCapture] Transcribe error:', err.message);
    }
  }, [session]);

  // Mobile resilience: background poll for transcripts every 3s in case mobile screen pauses WebSocket
  useEffect(() => {
    if (appMode !== 'second_screen' || !session?.id) return;
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/sessions/${session.id}/transcripts`);
        if (res.ok) {
          const list: TranscriptItem[] = await res.json();
          if (Array.isArray(list) && list.length > 0) {
            setTranscripts(prev => {
              const existingIds = new Set(prev.map(t => t.id));
              const missing = list.filter(t => !existingIds.has(t.id));
              if (missing.length === 0) return prev;
              return [...prev, ...missing];
            });
          }
        }
      } catch {}
    }, 3000);
    return () => clearInterval(pollInterval);
  }, [appMode, session?.id]);

  // Desktop Agent resilience: background poll for connected devices and primary status every 3s
  useEffect(() => {
    if (appMode !== 'desktop' || !session?.id || session.status === 'ended') return;
    const pollDevices = setInterval(async () => {
      try {
        const res = await fetch(`/api/sessions/${session.id}`);
        if (res.ok) {
          const data = await res.json();
          if (data?.devices && Array.isArray(data.devices)) {
            setSession(prev => {
              if (!prev || prev.status === 'ended') return prev;
              const prevDevs = prev.devices || [];
              const nextDevs = data.devices || [];
              const hasChanged = prevDevs.length !== nextDevs.length ||
                prev.primaryConnected !== data.primaryConnected ||
                JSON.stringify(prevDevs.map(d => d.id)) !== JSON.stringify(nextDevs.map(d => d.id));
              if (hasChanged) {
                return { ...prev, devices: nextDevs, primaryConnected: data.primaryConnected };
              }
              return prev;
            });
          }
        }
      } catch {}
    }, 3000);
    return () => clearInterval(pollDevices);
  }, [appMode, session?.id, session?.status]);

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
    profile: ContextProfile,
    experienceLevel: ExperienceLevel
  ) => {
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, title, profile, experienceLevel }),
      });
      if (res.ok) {
        const newSession: SessionState = await res.json();
        setSession(newSession);

        const primaryDev: DeviceInfo = {
          id: 'primary-capture-device',
          name: 'Primary Desktop Agent (Mac/PC)',
          type: 'CAPTURE',
          role: 'PRIMARY_CAPTURE',
          connectedAt: Date.now(),
          lastSeen: Date.now(),
        };
        registerSession(newSession.id, newSession.code, primaryDev);
        send('session.join', {
          sessionId: newSession.id,
          code: newSession.code,
          device: primaryDev,
        }, newSession.id);
      } else {
        throw new Error('API session creation non-200');
      }
    } catch (err) {
      console.warn('[App] Direct API create session failed, falling back to WebSocket:', err);
      send('session.create', {
        type,
        title,
        profile,
        experienceLevel,
      });
    }
  };

  const handleJoinSession = async (code: string, device: DeviceInfo) => {
    const cleanCode = code.trim().toUpperCase();
    try {
      const res = await fetch(`/api/sessions/code/${cleanCode}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Session code not found or expired.');
      }

      const data = await res.json();

      // 1. Guaranteed device pairing via REST first (persisted in SQLite & broadcast to Desktop Agent)
      try {
        const devRes = await fetch(`/api/sessions/${data.id}/devices`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(device),
        });
        if (devRes.ok) {
          const devData = await devRes.json();
          if (devData.session?.devices) {
            data.devices = devData.session.devices;
          }
        }
      } catch (devErr) {
        console.warn('[App] Device pairing REST call notice:', devErr);
      }

      setSession(data);
      sessionRef.current = data;
      setTranscripts(data.transcripts || []);
      setQuestions(data.questions || []);
      setCurrentQuestion(data.currentQuestion || null);
      setNotes(data.notes || []);

      const ansMap = new Map<string, GeneratedAnswer>();
      if (data.answers) {
        data.answers.forEach((a: GeneratedAnswer) => ansMap.set(a.questionId, a));
        setAnswers(ansMap);
        if (data.currentQuestion && ansMap.has(data.currentQuestion.id)) {
          setCurrentAnswer(ansMap.get(data.currentQuestion.id)!);
        }
      }

      // Switch IMMEDIATELY to second screen workspace!
      setAppMode('second_screen');

      // Register session for persistent auto-reconnect and join on WebSocket
      registerSession(data.id, cleanCode, device);
      send('session.join', { code: cleanCode, sessionId: data.id, device }, data.id);
    } catch (err: any) {
      console.warn('[App] Direct join failed, trying WebSocket join:', err);
      registerSession(undefined, cleanCode, device);
      send('session.join', { code: cleanCode, device });
      throw err;
    }
  };

  const handlePauseSession = async () => {
    if (!session) return;
    pauseAudioCapture();
    setSession(prev => prev ? { ...prev, status: 'paused' } : null);
    send('session.pause', {}, session.id);
    fetch(`/api/sessions/${session.id}/pause`, { method: 'POST' }).catch(() => {});
  };

  const handleResumeSession = async () => {
    if (!session) return;
    resumeAudioCapture();
    setSession(prev => prev ? { ...prev, status: 'active' } : null);
    send('session.resume', {}, session.id);
    fetch(`/api/sessions/${session.id}/resume`, { method: 'POST' }).catch(() => {});
  };

  const handleEndSession = async () => {
    if (!session) return;
    // 1. Immediately shut off hardware mic and system audio recorders
    stopMicrophone();
    stopSystemAudio();
    // 2. Set ended status locally to freeze UI immediately without lag
    setSession(prev => prev ? { ...prev, status: 'ended' } : null);
    // 3. Notify backend via WebSocket
    send('session.end', {}, session.id);
    // 4. Guaranteed REST call
    try {
      const res = await fetch(`/api/sessions/${session.id}/end`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          setSession(prev => prev ? { ...prev, status: 'ended', durationSeconds: data.session.durationSeconds } : null);
        }
      }
    } catch {}
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
              fetch('/api/profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(prof),
              });
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
