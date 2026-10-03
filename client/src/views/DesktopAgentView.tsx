import React, { useState, useEffect } from 'react';
import {
  Mic,
  Volume2,
  Play,
  Pause,
  PowerOff,
  QrCode,
  Laptop,
  Smartphone,
  Sparkles,
  Settings,
  Sliders,
  CheckCircle2,
  ExternalLink,
  MessageSquare,
  Send,
  Zap,
  Radio,
} from 'lucide-react';
import {
  ContextProfile,
  SessionState,
  SessionType,
  ExperienceLevel,
  TranscriptItem,
  DetectedQuestion,
  GeneratedAnswer,
} from '../types';
import { AudioVisualizer } from '../components/AudioVisualizer';
import { QRCodeDisplay } from '../components/QRCodeDisplay';
import { DeviceHealthBar } from '../components/DeviceHealthBar';
import { InterviewSimulator } from '../components/InterviewSimulator';
import { PostSessionView } from './PostSessionView';

interface DesktopAgentViewProps {
  session: SessionState | null;
  latencyMs: number;
  localIp?: string;
  isMicActive: boolean;
  isSystemAudioActive: boolean;
  micVolume: number;
  systemVolume: number;
  vadActive: boolean;
  transcripts: TranscriptItem[];
  questions: DetectedQuestion[];
  currentQuestion: DetectedQuestion | null;
  currentAnswer: GeneratedAnswer | null;
  onStartMicrophone: () => void;
  onStopMicrophone: () => void;
  onStartSystemAudio: () => void;
  onStopSystemAudio: () => void;
  onCreateSession: (type: SessionType, title: string, profile: ContextProfile, experienceLevel: ExperienceLevel) => void;
  onPauseSession: () => void;
  onResumeSession: () => void;
  onEndSession: () => void;
  onSimulateSpeech: (speaker: 'OTHER' | 'YOU', text: string) => void;
}

const DEFAULT_FALLBACK_PROFILE: ContextProfile = {
  id: 'default-profile',
  name: 'Senior React Native & Fullstack Lead',
  role: 'Senior Staff Software Engineer',
  experience: '6 Years',
  resumeText: 'Senior Software Engineer with 6+ years of experience architecting high-scale mobile and web applications with React Native, TypeScript, React, Node.js, and Distributed Cloud Systems.',
  jobDescriptionText: 'Role: Senior Staff Mobile/Fullstack Architect. Requirements: Deep expertise in React Native new architecture (Fabric, TurboModules, JSI, Hermes), distributed real-time systems, and high performance.',
  projectNotesText: 'Accomplishments: Video OTT Playback Engine with JSI; Black Friday Redis cache stampede incident resolution with probabilistic early expiration in 18 minutes.',
  preferredLanguage: 'TypeScript',
};

export const DesktopAgentView: React.FC<DesktopAgentViewProps> = ({
  session,
  latencyMs,
  localIp,
  isMicActive,
  isSystemAudioActive,
  micVolume,
  systemVolume,
  vadActive,
  transcripts,
  questions,
  currentQuestion,
  currentAnswer,
  onStartMicrophone,
  onStopMicrophone,
  onStartSystemAudio,
  onStopSystemAudio,
  onCreateSession,
  onPauseSession,
  onResumeSession,
  onEndSession,
  onSimulateSpeech,
}) => {
  const [sessionType, setSessionType] = useState<SessionType>('technical');
  const [sessionTitle, setSessionTitle] = useState('Senior React Native Interview');
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>('senior');
  const [profiles, setProfiles] = useState<ContextProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('default-profile');
  const [showQrModal, setShowQrModal] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [customSpeechText, setCustomSpeechText] = useState('');
  const [customSpeaker, setCustomSpeaker] = useState<'OTHER' | 'YOU'>('OTHER');

  useEffect(() => {
    fetch('/api/profiles')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setProfiles(data);
          setSelectedProfileId(data[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const handleStartSession = async () => {
    if (isStarting) return;
    setIsStarting(true);
    try {
      const profile = profiles.find(p => p.id === selectedProfileId) || profiles[0] || DEFAULT_FALLBACK_PROFILE;
      await onCreateSession(sessionType, sessionTitle, profile, experienceLevel);
      // Try to start microphone gracefully without blocking UI
      try {
        onStartMicrophone();
      } catch (e) {
        console.warn('Microphone auto-start note:', e);
      }
    } catch (err) {
      console.error('Failed to start session:', err);
    } finally {
      setIsStarting(false);
    }
  };

  // If session has ended, show Post-Session Review & Analytics (PRD §50-51)
  if (session && session.status === 'ended') {
    return (
      <div style={{ maxWidth: '880px', margin: '36px auto', padding: '0 20px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '24px',
          background: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.25)',
          padding: '16px 20px',
          borderRadius: '12px',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="status-dot active" style={{ background: '#10b981' }} />
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                Session Completed: {session.title}
              </h2>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '0.84rem', margin: '4px 0 0 0' }}>
              Audio capture successfully ended. Review topic coverage, interview questions, and export debrief below.
            </p>
          </div>

          <button
            onClick={() => {
              window.location.href = '/?mode=desktop';
            }}
            className="btn btn-primary"
            style={{ fontWeight: 700 }}
          >
            <Sparkles size={15} /> Start New Session
          </button>
        </div>

        <PostSessionView sessionId={session.id} isSessionActive={false} />
      </div>
    );
  }

  // If no session created yet, show clean session setup screen (PRD Section 11)
  if (!session) {
    return (
      <div style={{ maxWidth: '780px', margin: '36px auto', padding: '0 20px' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(0, 242, 254, 0.1)',
            border: '1px solid rgba(0, 242, 254, 0.25)',
            padding: '6px 14px',
            borderRadius: '999px',
            color: '#00f2fe',
            fontSize: '0.8rem',
            fontWeight: 600,
            marginBottom: '12px',
          }}>
            <Laptop size={14} /> Desktop Capture Agent • macOS / Windows
          </div>
          <h1 style={{ fontSize: '2.2rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
            Start New SideBro Session
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.96rem', marginTop: '6px' }}>
            Capture call audio locally on this computer. Use your phone or tablet as the AI second screen.
          </p>
        </div>

        <div className="glass-panel" style={{ padding: '32px' }}>
          {/* 1. Session Type Selection (PRD Section 11) */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '10px' }}>
              Session Type
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
              {(['technical', 'behavioral', 'system_design', 'coding', 'sales', 'meeting'] as SessionType[]).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setSessionType(type)}
                  style={{
                    background: sessionType === type ? 'rgba(0, 242, 254, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                    border: sessionType === type ? '1px solid #00f2fe' : '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '10px',
                    padding: '12px 14px',
                    color: sessionType === type ? '#ffffff' : '#94a3b8',
                    fontSize: '0.86rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {type.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Experience Level */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '10px' }}>
              Experience Level Calibration (PRD Section 44)
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {(['junior', 'mid', 'senior', 'staff'] as ExperienceLevel[]).map(lvl => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setExperienceLevel(lvl)}
                  className={`chip ${experienceLevel === lvl ? 'active' : ''}`}
                  style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                >
                  {lvl.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Context Profile (Resume, JD, Project Notes) */}
          <div style={{ marginBottom: '28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <label style={{ fontSize: '0.84rem', fontWeight: 600, color: '#e2e8f0' }}>
                Context Profile & Documents (PRD Section 23)
              </label>
              <span style={{ fontSize: '0.74rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <CheckCircle2 size={12} /> Resume & JD Loaded
              </span>
            </div>
            <select
              value={selectedProfileId}
              onChange={e => setSelectedProfileId(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '10px',
                padding: '12px 14px',
                color: '#f8fafc',
                fontSize: '0.9rem',
                outline: 'none',
              }}
            >
              {profiles.map(p => (
                <option key={p.id} value={p.id} style={{ background: '#0d121d' }}>
                  {p.name} ({p.experience})
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', fontSize: '0.74rem', color: '#64748b' }}>
              <span>✓ Resume</span>
              <span>✓ Job Description</span>
              <span>✓ Video OTT Playback Notes</span>
              <span>✓ Incident Response Notes</span>
            </div>
          </div>

          {/* 4. Audio Capture Permissions Preview */}
          <div style={{
            background: 'rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '28px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#cbd5e1' }}>
                Audio Sources
              </span>
              <span style={{ fontSize: '0.74rem', color: '#38bdf8' }}>Ready to capture</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.84rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#e2e8f0' }}>
                  <Mic size={15} color="#00f2fe" /> MacBook / System Microphone
                </span>
                <span style={{ color: '#10b981', fontWeight: 600 }}>Active</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.84rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#e2e8f0' }}>
                  <Volume2 size={15} color="#f59e0b" /> Zoom / Meet System Audio
                </span>
                <span style={{ color: '#10b981', fontWeight: 600 }}>Enabled</span>
              </div>
            </div>
          </div>

          {/* Launch Session Button */}
          <button
            onClick={handleStartSession}
            disabled={isStarting}
            className="btn btn-primary"
            style={{ width: '100%', padding: '15px', fontSize: '1.05rem', fontWeight: 700, opacity: isStarting ? 0.7 : 1 }}
          >
            <Play size={18} /> {isStarting ? 'STARTING SIDEBRO SESSION...' : 'START SIDEBRO SESSION'}
          </button>
        </div>
      </div>
    );
  }

  // ACTIVE SESSION HUD (PRD Section 15: Primary Desktop Agent UI)
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <DeviceHealthBar
        session={session}
        latencyMs={latencyMs}
        isPrimary={true}
        onPause={onPauseSession}
        onResume={onResumeSession}
        onEnd={onEndSession}
      />

      <div style={{ maxWidth: '980px', margin: '24px auto', padding: '0 20px', width: '100%' }}>
        {/* Header Notification */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '20px',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="status-dot active" />
              <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc' }}>
                {session.title}
              </h2>
            </div>
            <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: '2px' }}>
              Primary Capture Agent is listening. All questions & answers stream to your second device.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setShowQrModal(!showQrModal)}
              className="btn btn-secondary btn-sm"
            >
              <QrCode size={14} /> {showQrModal ? 'Hide QR' : 'Show Pairing QR'}
            </button>
            <a
              href={`/?join=${session.code}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-sm"
            >
              <ExternalLink size={14} /> Open Second Screen
            </a>
          </div>
        </div>

        {/* 1. Quick Voice Transcribe & Simulation Bar (PRD §15 & §69) */}
        <div className="glass-panel" style={{ padding: '16px 20px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                background: 'rgba(0, 242, 254, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#00f2fe',
              }}>
                <Radio size={15} />
              </div>
              <div>
                <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#f8fafc' }}>
                  Live Speech Ingestion & Multi-Device Sync
                </span>
                <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block' }}>
                  Transmit real-time conversation audio to both this desktop and paired second screen devices
                </span>
              </div>
            </div>

            {/* Speaker Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>SPEAKER:</span>
              <button
                type="button"
                onClick={() => setCustomSpeaker('OTHER')}
                style={{
                  background: customSpeaker === 'OTHER' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                  border: customSpeaker === 'OTHER' ? '1px solid #f59e0b' : '1px solid rgba(255, 255, 255, 0.1)',
                  color: customSpeaker === 'OTHER' ? '#f59e0b' : '#94a3b8',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                INTERVIEWER (OTHER)
              </button>
              <button
                type="button"
                onClick={() => setCustomSpeaker('YOU')}
                style={{
                  background: customSpeaker === 'YOU' ? 'rgba(0, 242, 254, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                  border: customSpeaker === 'YOU' ? '1px solid #00f2fe' : '1px solid rgba(255, 255, 255, 0.1)',
                  color: customSpeaker === 'YOU' ? '#00f2fe' : '#94a3b8',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                CANDIDATE (YOU)
              </button>
            </div>
          </div>

          {/* Quick 1-Click Spoken Speech Chips */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'flex', alignItems: 'center' }}>1-Click Say:</span>
            {[
              { label: 'Bridge vs JSI', text: 'Can you explain the difference between the React Native Bridge and JSI?', speaker: 'OTHER' as const },
              { label: 'React Fiber', text: 'How does React Fiber work under the hood?', speaker: 'OTHER' as const },
              { label: 'STAR Incident', text: 'Tell me about a time when a critical production incident occurred.', speaker: 'OTHER' as const },
              { label: 'Rate Limiter', text: 'How would you design a distributed rate limiter to handle 100k+ RPS?', speaker: 'OTHER' as const },
              { label: 'Candidate Answer', text: 'In our production app, we resolved this by replacing JSON serialization with direct C++ JSI host objects, reducing render latency by 45%.', speaker: 'YOU' as const },
            ].map((chip, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onSimulateSpeech(chip.speaker, chip.text)}
                className="chip"
                style={{
                  fontSize: '0.74rem',
                  borderColor: chip.speaker === 'YOU' ? 'rgba(0, 242, 254, 0.3)' : 'rgba(245, 158, 11, 0.3)',
                  color: chip.speaker === 'YOU' ? '#38bdf8' : '#fbbf24',
                }}
              >
                <Zap size={11} /> {chip.label}
              </button>
            ))}
          </div>

          {/* Custom Speech Transcribe Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!customSpeechText.trim()) return;
              onSimulateSpeech(customSpeaker, customSpeechText.trim());
              setCustomSpeechText('');
            }}
            style={{ display: 'flex', gap: '8px' }}
          >
            <input
              type="text"
              value={customSpeechText}
              onChange={e => setCustomSpeechText(e.target.value)}
              placeholder={customSpeaker === 'OTHER' ? 'Type or dictate interviewer question (e.g. "How does Hermes engine optimize startup?")...' : 'Type or dictate candidate response...'}
              style={{
                flex: 1,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '8px',
                padding: '8px 12px',
                fontSize: '0.84rem',
                color: '#f8fafc',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={!customSpeechText.trim()}
              className="btn btn-primary btn-sm"
              style={{ padding: '8px 16px', opacity: customSpeechText.trim() ? 1 : 0.6 }}
            >
              <Send size={13} /> Transmit
            </button>
          </form>
        </div>

        {/* 2. Main Grid: Audio Visualizer + Second Screen Pairing Card */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px', marginBottom: '24px' }}>
          {/* Left Column: Live Audio Capture & VAD */}
          <div className="glass-panel" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Mic size={16} color="#00f2fe" />
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f8fafc' }}>
                  Live Audio Pipeline
                </span>
              </div>
              <span style={{
                fontSize: '0.72rem',
                color: vadActive ? '#10b981' : '#64748b',
                fontWeight: 600,
              }}>
                {vadActive ? 'Speech Detected' : 'Listening...'}
              </span>
            </div>

            <AudioVisualizer
              micVolume={micVolume}
              systemVolume={systemVolume}
              isMicActive={isMicActive}
              isSystemAudioActive={isSystemAudioActive}
              vadActive={vadActive}
            />

            {/* Audio Toggle Controls */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button
                onClick={isMicActive ? onStopMicrophone : onStartMicrophone}
                className={`btn btn-sm ${isMicActive ? 'btn-secondary' : 'btn-primary'}`}
                style={{ flex: 1 }}
              >
                <Mic size={13} /> {isMicActive ? 'Mute Mic' : 'Start Mic'}
              </button>
              <button
                onClick={isSystemAudioActive ? onStopSystemAudio : onStartSystemAudio}
                className={`btn btn-sm ${isSystemAudioActive ? 'btn-secondary' : 'btn-primary'}`}
                style={{ flex: 1 }}
              >
                <Volume2 size={13} /> {isSystemAudioActive ? 'Stop System Audio' : 'Start System Audio'}
              </button>
            </div>

            <div style={{ marginTop: '16px', fontSize: '0.76rem', color: '#64748b', lineHeight: 1.5 }}>
              💡 <strong>Speaker Separation</strong>: Mic audio is tagged as <code>YOU</code> (Candidate). System/meeting audio is tagged as <code>OTHER</code> (Interviewer).
            </div>
          </div>

          {/* Right Column: QR Code & Pairing */}
          <div>
            <QRCodeDisplay
              sessionCode={session.code}
              sessionId={session.id}
              connectedDevices={session.devices}
              localIp={localIp}
            />
          </div>
        </div>

        {/* 3. Real-Time Live Transcript Feed & Active Copilot HUD */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px', marginBottom: '24px' }}>
          {/* Left: Live Transcript Stream */}
          <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <MessageSquare size={15} color="#00f2fe" />
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f8fafc' }}>
                  Live Transcripts Feed
                </span>
              </div>
              <span style={{
                background: 'rgba(255, 255, 255, 0.08)',
                padding: '2px 8px',
                borderRadius: '999px',
                fontSize: '0.72rem',
                color: '#94a3b8',
              }}>
                {transcripts.length} messages
              </span>
            </div>

            {/* Transcript Messages List */}
            <div style={{
              flex: 1,
              maxHeight: '260px',
              minHeight: '160px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              paddingRight: '4px',
            }}>
              {transcripts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px 12px', color: '#64748b', fontSize: '0.82rem' }}>
                  No speech transcribed yet.<br />
                  <span style={{ fontSize: '0.75rem', color: '#475569' }}>
                    Speak into your microphone or click one of the 1-click test chips above.
                  </span>
                </div>
              ) : (
                transcripts.slice(-10).map((t) => {
                  const isYou = t.speaker === 'YOU';
                  return (
                    <div
                      key={t.id}
                      style={{
                        background: isYou ? 'rgba(0, 242, 254, 0.06)' : 'rgba(245, 158, 11, 0.06)',
                        borderLeft: `3px solid ${isYou ? '#00f2fe' : '#f59e0b'}`,
                        borderRadius: '6px',
                        padding: '8px 10px',
                        fontSize: '0.82rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          color: isYou ? '#00f2fe' : '#f59e0b',
                        }}>
                          {isYou ? 'YOU (Candidate)' : 'OTHER (Interviewer)'}
                        </span>
                        <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
                          {new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                      <p style={{ color: '#e2e8f0', margin: 0, lineHeight: 1.4 }}>
                        {t.text}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Active Detected Question & AI Answer Preview */}
          <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={15} color="#a855f7" />
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f8fafc' }}>
                  SideBro AI Live Stream
                </span>
              </div>
              <span style={{
                fontSize: '0.7rem',
                color: currentAnswer && !currentAnswer.isComplete ? '#10b981' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}>
                {currentAnswer && !currentAnswer.isComplete && (
                  <span className="status-dot active" style={{ width: '6px', height: '6px' }} />
                )}
                {currentAnswer ? (currentAnswer.isComplete ? 'Answer Ready' : 'Streaming Tokens...') : 'Awaiting Question'}
              </span>
            </div>

            {currentQuestion ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{
                  background: 'rgba(168, 85, 247, 0.1)',
                  border: '1px solid rgba(168, 85, 247, 0.25)',
                  borderRadius: '8px',
                  padding: '10px 12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      color: '#c084fc',
                      textTransform: 'uppercase',
                    }}>
                      Question Detected • {currentQuestion.type}
                    </span>
                    <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                      {Math.round(currentQuestion.confidence * 100)}% Confidence
                    </span>
                  </div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f8fafc' }}>
                    "{currentQuestion.questionText}"
                  </div>
                </div>

                {currentAnswer ? (
                  <div style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '8px',
                    padding: '12px',
                    maxHeight: '180px',
                    overflowY: 'auto',
                  }}>
                    <div style={{ fontSize: '0.72rem', color: '#38bdf8', fontWeight: 700, marginBottom: '4px' }}>
                      Direct Answer (Synced to Second Screen):
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#cbd5e1', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      {currentAnswer.fullContent || currentAnswer.directAnswer}
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
                    Generating response...
                  </div>
                )}
              </div>
            ) : (
              <div style={{
                padding: '40px 16px',
                textAlign: 'center',
                color: '#64748b',
                fontSize: '0.82rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
              }}>
                <Sparkles size={24} color="#64748b" />
                <span>No question detected yet.</span>
                <span style={{ fontSize: '0.75rem', color: '#475569' }}>
                  When the interviewer asks a question, it will be automatically analyzed and answered here and on your phone!
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 4. Interactive Interview Simulator (PRD Section 69 MVP User Journey) */}
        <InterviewSimulator
          sessionId={session.id}
          onSimulateChunk={onSimulateSpeech}
        />
      </div>
    </div>
  );
};
