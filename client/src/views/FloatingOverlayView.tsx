import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Maximize2,
  Mic,
  MicOff,
  Sparkles,
  Zap,
  Copy,
  Check,
  Send,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Camera,
  Eye,
  User,
  Users,
} from 'lucide-react';
import {
  AnswerLengthMode,
  DetectedQuestion,
  GeneratedAnswer,
  SessionState,
  TranscriptItem,
} from '../types';
import { FormattedText } from '../components/FormattedText';
import { CodingAnswerPanel, CodingLanes, CodingSource } from '../components/CodingAnswerPanel';

interface FloatingOverlayViewProps {
  session: SessionState | null;
  latencyMs: number;
  isMicActive: boolean;
  isSystemAudioActive: boolean;
  micVolume: number;
  systemVolume: number;
  vadActive: boolean;
  micRole: 'OTHER' | 'YOU';
  transcripts: TranscriptItem[];
  questions: DetectedQuestion[];
  currentQuestion: DetectedQuestion | null;
  currentAnswer: GeneratedAnswer | null;
  codingLanes: CodingLanes;
  onDismissCodingLane: (source: CodingSource) => void;
  onCaptureScreenshot?: () => void;
  isProtected: boolean;
  onToggleProtection: () => void;
  onExitFloatingMode: () => void;
  onToggleMicrophone: () => void;
  onToggleMicRole: () => void;
  onEnsureSession: () => void;
  onLengthModeChange: (mode: AnswerLengthMode) => void;
  onTriggerModifier: (modifier: 'shorter' | 'expand' | 'example' | 'technical_detail' | 'star' | 'alternative') => void;
  onManualAsk: (text: string) => void;
}

const OPACITY_STEPS = [1.0, 0.8, 0.6, 0.45, 0.3];
const ACCENT = '#7dd3fc';
const isMac = window.electronAPI?.platform === 'darwin';
// On macOS the Electron window gets native vibrancy, so the page stays see-through to show the frosted glass.
const useNativeGlass = Boolean(window.electronAPI?.isElectron && isMac);

const iconButton = (active = false): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '5px',
  height: '30px',
  minWidth: '30px',
  padding: '0 9px',
  borderRadius: '999px',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  background: active ? 'rgba(125, 211, 252, 0.16)' : 'rgba(255, 255, 255, 0.06)',
  color: active ? ACCENT : '#cbd5e1',
  fontSize: '0.7rem',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties);

/** Five bars that bounce with the loudest live audio source, the "listening" signal in the bar. */
const ListeningWave: React.FC<{ level: number; active: boolean }> = ({ level, active }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '2px', height: '14px' }}>
    {[0.55, 0.85, 1, 0.75, 0.5].map((weight, i) => (
      <span
        key={i}
        style={{
          width: '3px',
          borderRadius: '2px',
          background: active ? ACCENT : '#475569',
          height: active ? `${Math.max(3, Math.min(14, 3 + level * 40 * weight))}px` : '3px',
          transition: 'height 0.09s ease',
          animation: active && level < 0.02 ? `sb-idle-wave 1.2s ${i * 0.12}s ease-in-out infinite` : undefined,
        }}
      />
    ))}
  </div>
);

export const FloatingOverlayView: React.FC<FloatingOverlayViewProps> = ({
  session,
  latencyMs,
  isMicActive,
  isSystemAudioActive,
  micVolume,
  systemVolume,
  micRole,
  transcripts,
  questions,
  currentQuestion,
  currentAnswer,
  isProtected,
  onToggleProtection,
  onExitFloatingMode,
  onToggleMicrophone,
  onToggleMicRole,
  onEnsureSession,
  onTriggerModifier,
  onManualAsk,
  codingLanes,
  onDismissCodingLane,
  onCaptureScreenshot,
}) => {
  const [activeTab, setActiveTab] = useState<'ANSWERS' | 'TRANSCRIPTS'>('ANSWERS');
  const [opacityLevel, setOpacityLevel] = useState<number>(1.0);
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [customQuery, setCustomQuery] = useState('');
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState<number>(-1);
  const transcriptsEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-activate session and microphone if in stealth mode without active listening
  useEffect(() => {
    if (!session || session.status !== 'active') {
      onEnsureSession();
    }
  }, [session?.status]);

  // Let the native window vibrancy show through while the overlay is mounted
  useEffect(() => {
    if (!useNativeGlass) return;
    const { body, documentElement } = document;
    const prev = { body: body.style.background, html: documentElement.style.background };
    body.style.background = 'transparent';
    documentElement.style.background = 'transparent';
    return () => {
      body.style.background = prev.body;
      documentElement.style.background = prev.html;
    };
  }, []);

  // Keep the Electron window height in sync with the collapsed bar / expanded card
  useEffect(() => {
    window.electronAPI?.setOverlayCollapsed?.(collapsed).catch(() => {});
  }, [collapsed]);

  // A fresh answer pops the card back open, like Parakeet's auto-expand
  useEffect(() => {
    if (currentAnswer?.id) setCollapsed(false);
  }, [currentAnswer?.id]);

  // Sync selected index when new questions arrive
  useEffect(() => {
    if (questions.length > 0) {
      setSelectedQuestionIndex(questions.length - 1);
    }
  }, [questions.length]);

  // Scroll transcripts to bottom when new transcripts arrive
  useEffect(() => {
    if (activeTab === 'TRANSCRIPTS') {
      transcriptsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcripts.length, activeTab]);

  const displayedQuestion =
    selectedQuestionIndex >= 0 && selectedQuestionIndex < questions.length
      ? questions[selectedQuestionIndex]
      : currentQuestion;
  const questionPosition = selectedQuestionIndex >= 0 ? selectedQuestionIndex : questions.length - 1;
  const isListening = isMicActive || isSystemAudioActive;
  const audioLevel = Math.max(isMicActive ? micVolume : 0, isSystemAudioActive ? systemVolume : 0);

  const cycleOpacity = () => {
    const next = OPACITY_STEPS[(OPACITY_STEPS.indexOf(opacityLevel) + 1) % OPACITY_STEPS.length];
    setOpacityLevel(next);
    window.electronAPI?.setWindowOpacity?.(next);
  };

  const handleCopyAnswer = () => {
    if (!currentAnswer) return;
    const text = currentAnswer.fullContent || currentAnswer.directAnswer || '';
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customQuery.trim()) return;
    onManualAsk(customQuery.trim());
    setCustomQuery('');
    setActiveTab('ANSWERS');
    setCollapsed(false);
  };

  const sampleQuestions = [
    'How does React reconciliation work?',
    'Explain microservices vs monolith architecture',
    'How to design a distributed rate limiter?',
  ];

  const modKey = isMac ? '⌘' : 'Ctrl';

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: useNativeGlass ? 'rgba(14, 16, 22, 0.22)' : 'rgba(14, 16, 22, 0.78)',
        color: '#f1f5f9',
        fontFamily: 'var(--font-sans)',
        overflow: 'hidden',
        borderRadius: useNativeGlass ? 0 : '14px',
        border: useNativeGlass ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      <style>{`
        @keyframes sb-idle-wave { 0%, 100% { height: 3px; } 50% { height: 9px; } }
        @keyframes sb-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        .sb-overlay-scroll::-webkit-scrollbar { width: 6px; }
        .sb-overlay-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
        .sb-chip:hover:not(:disabled) { background: rgba(255,255,255,0.12) !important; color: #f8fafc !important; }
      `}</style>

      {/* Control bar: the whole strip drags the window; every control opts out of dragging */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          height: '56px',
          flexShrink: 0,
          padding: '0 12px',
          WebkitAppRegion: 'drag',
          userSelect: 'none',
          cursor: 'grab',
          borderBottom: collapsed ? 'none' : '1px solid rgba(255, 255, 255, 0.07)',
        } as React.CSSProperties}
      >
        {/* Listening status pill */}
        <button
          onClick={onToggleMicrophone}
          style={{
            ...iconButton(isMicActive),
            padding: '0 12px 0 10px',
            gap: '8px',
            background: isMicActive ? 'rgba(125, 211, 252, 0.12)' : 'rgba(239, 68, 68, 0.12)',
            color: isMicActive ? ACCENT : '#f87171',
          }}
          title={isMicActive ? 'Listening. Click to mute the microphone.' : 'Microphone is off. Click to start listening.'}
        >
          {isMicActive ? <Mic size={13} /> : <MicOff size={13} />}
          <ListeningWave level={audioLevel} active={isListening} />
          <span>{isListening ? 'Listening' : 'Paused'}</span>
        </button>

        <button
          onClick={onToggleMicRole}
          style={iconButton(micRole === 'OTHER')}
          title="Toggle whether microphone speech is the interviewer (answers are generated) or you (context only)."
        >
          {micRole === 'OTHER' ? <Users size={13} /> : <User size={13} />}
          <span>{micRole === 'OTHER' ? 'Interviewer' : 'You'}</span>
        </button>

        <div style={{ flex: 1 }} />

        {onCaptureScreenshot && (
          <button
            onClick={onCaptureScreenshot}
            style={iconButton()}
            title={`Solve the coding problem on screen (${modKey}+Alt+Shift+S)`}
          >
            <Camera size={13} />
            <span>Screen</span>
          </button>
        )}

        <button
          onClick={onToggleProtection}
          style={{
            ...iconButton(),
            color: isProtected ? '#34d399' : '#f87171',
            background: isProtected ? 'rgba(52, 211, 153, 0.1)' : 'rgba(248, 113, 113, 0.12)',
          }}
          title={
            isProtected
              ? 'Hidden from screen share (Meet, Zoom, Teams). Click to turn off.'
              : 'Visible in screen share. Click to hide this window from captures.'
          }
        >
          {isProtected ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
          {!isProtected && <span>Visible</span>}
        </button>

        <button onClick={cycleOpacity} style={iconButton(opacityLevel < 1)} title="Cycle window opacity">
          <Eye size={13} />
          <span>{Math.round(opacityLevel * 100)}%</span>
        </button>

        <button
          onClick={() => setCollapsed(c => !c)}
          style={iconButton()}
          title={collapsed ? 'Expand answer card' : 'Collapse to bar'}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>

        <button onClick={onExitFloatingMode} style={iconButton()} title="Back to full window">
          <Maximize2 size={13} />
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Question header + view switcher */}
          <div style={{ padding: '12px 18px 0', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.66rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <span>{displayedQuestion ? displayedQuestion.type || 'Question' : 'Waiting for a question'}</span>
                {questions.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '2px', textTransform: 'none' }}>
                    <button
                      onClick={() => setSelectedQuestionIndex(Math.max(0, questionPosition - 1))}
                      disabled={questionPosition === 0}
                      style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '1px', display: 'flex' }}
                    >
                      <ChevronLeft size={13} />
                    </button>
                    <span>{questionPosition + 1}/{questions.length}</span>
                    <button
                      onClick={() => setSelectedQuestionIndex(Math.min(questions.length - 1, questionPosition + 1))}
                      disabled={questionPosition === questions.length - 1}
                      style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '1px', display: 'flex' }}
                    >
                      <ChevronRight size={13} />
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', background: 'rgba(0, 0, 0, 0.25)', borderRadius: '999px', padding: '2px' }}>
                {([
                  { id: 'ANSWERS' as const, label: 'Answer', Icon: Sparkles },
                  { id: 'TRANSCRIPTS' as const, label: `Transcript${transcripts.length ? ` · ${transcripts.length}` : ''}`, Icon: MessageSquare },
                ]).map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: activeTab === id ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                      color: activeTab === id ? '#f8fafc' : '#94a3b8',
                      border: 'none',
                      padding: '3px 10px',
                      borderRadius: '999px',
                      fontSize: '0.66rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <Icon size={10} /> {label}
                  </button>
                ))}
              </div>
            </div>

            {activeTab === 'ANSWERS' && (
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#f8fafc', lineHeight: 1.4 }}>
                {displayedQuestion ? (
                  displayedQuestion.questionText
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {sampleQuestions.map((sq, i) => (
                      <button
                        key={i}
                        className="sb-chip"
                        onClick={() => onManualAsk(sq)}
                        style={{
                          background: 'rgba(255, 255, 255, 0.06)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          color: '#cbd5e1',
                          fontSize: '0.7rem',
                          fontWeight: 500,
                          padding: '4px 10px',
                          borderRadius: '999px',
                          cursor: 'pointer',
                        }}
                      >
                        {sq}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Main content */}
          <div
            className="sb-overlay-scroll"
            style={{ flex: 1, overflowY: 'auto', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            {activeTab === 'TRANSCRIPTS' ? (
              transcripts.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '0.78rem', textAlign: 'center' }}>
                  <Mic size={22} style={{ opacity: 0.35, marginBottom: '8px' }} />
                  <span>Live speech will stream here as the conversation happens.</span>
                </div>
              ) : (
                <>
                  {transcripts.map((t, idx) => (
                    <div key={t.id || idx} style={{ fontSize: '0.82rem', lineHeight: 1.45 }}>
                      <span style={{ fontSize: '0.64rem', fontWeight: 700, marginRight: '8px', color: t.speaker === 'OTHER' ? ACCENT : '#34d399' }}>
                        {t.speaker === 'OTHER' ? 'INTERVIEWER' : 'YOU'}
                      </span>
                      <span style={{ color: '#e2e8f0' }}>{t.text}</span>
                    </div>
                  ))}
                  <div ref={transcriptsEndRef} />
                </>
              )
            ) : (
              <>
                {currentAnswer ? (
                  <div style={{ fontSize: '0.9rem', lineHeight: 1.6, color: '#e2e8f0' }}>
                    {currentAnswer.directAnswer && (
                      <div style={{ color: '#f8fafc', fontWeight: 500, fontSize: '0.98rem', marginBottom: '10px' }}>
                        <FormattedText text={currentAnswer.directAnswer} />
                      </div>
                    )}

                    {currentAnswer.keyPoints && currentAnswer.keyPoints.length > 0 && (
                      <ul style={{ paddingLeft: '18px', margin: '4px 0 8px', color: '#cbd5e1' }}>
                        {currentAnswer.keyPoints.map((pt, idx) => (
                          <li key={idx} style={{ marginBottom: '5px' }}>
                            <FormattedText text={pt} />
                          </li>
                        ))}
                      </ul>
                    )}

                    {currentAnswer.exampleOrSnippet && (
                      <pre
                        style={{
                          background: 'rgba(0, 0, 0, 0.35)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: '10px',
                          padding: '10px 12px',
                          fontSize: '0.76rem',
                          fontFamily: 'var(--font-mono)',
                          color: '#bae6fd',
                          overflowX: 'auto',
                          margin: '8px 0',
                        }}
                      >
                        <code>{currentAnswer.exampleOrSnippet}</code>
                      </pre>
                    )}

                    {/* Full streaming markdown if direct answer is not yet parsed */}
                    {!currentAnswer.directAnswer && currentAnswer.fullContent && (
                      <div style={{ whiteSpace: 'pre-wrap' }}>
                        <FormattedText text={currentAnswer.fullContent} />
                      </div>
                    )}

                    {!currentAnswer.isComplete && (
                      <span style={{ display: 'inline-block', width: '7px', height: '14px', background: ACCENT, borderRadius: '1px', animation: 'sb-pulse 0.9s ease-in-out infinite', verticalAlign: 'middle' }} />
                    )}
                  </div>
                ) : (
                  <div style={{ flex: 1, minHeight: '120px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '0.78rem', textAlign: 'center' }}>
                    <Zap size={22} style={{ opacity: 0.35, marginBottom: '8px' }} />
                    <span>Answers appear here the moment a question is heard or typed.</span>
                  </div>
                )}

                {/* Clipboard / screenshot solutions, shown only once something was copied or captured */}
                {(['clipboard', 'screen'] as const).map(source => (
                  <CodingAnswerPanel
                    key={source}
                    source={source}
                    lane={codingLanes[source]}
                    onDismiss={() => onDismissCodingLane(source)}
                    compact
                  />
                ))}
              </>
            )}
          </div>

          {/* Follow-up chips + silent ask */}
          <div style={{ padding: '8px 14px 10px', borderTop: '1px solid rgba(255, 255, 255, 0.07)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {activeTab === 'ANSWERS' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                {[
                  { id: 'shorter' as const, label: 'Shorter' },
                  { id: 'expand' as const, label: 'Explain more' },
                  { id: 'example' as const, label: 'Example' },
                  { id: 'technical_detail' as const, label: 'Go technical' },
                  { id: 'star' as const, label: 'STAR story' },
                ].map((chip) => (
                  <button
                    key={chip.id}
                    className="sb-chip"
                    onClick={() => onTriggerModifier(chip.id)}
                    disabled={!currentAnswer}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      color: currentAnswer ? '#cbd5e1' : '#475569',
                      padding: '3px 10px',
                      borderRadius: '999px',
                      fontSize: '0.66rem',
                      fontWeight: 500,
                      cursor: currentAnswer ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {chip.label}
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                {currentAnswer && (
                  <button onClick={handleCopyAnswer} style={{ ...iconButton(), height: '24px', color: copied ? '#34d399' : '#94a3b8' }}>
                    {copied ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
              </div>
            )}

            <form onSubmit={handleManualSubmit} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="text"
                value={customQuery}
                onChange={(e) => setCustomQuery(e.target.value)}
                placeholder="Ask anything silently…"
                style={{
                  flex: 1,
                  background: 'rgba(0, 0, 0, 0.28)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '999px',
                  padding: '7px 14px',
                  fontSize: '0.78rem',
                  color: '#f8fafc',
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={!customQuery.trim()}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '999px',
                  border: 'none',
                  background: customQuery.trim() ? ACCENT : 'rgba(255, 255, 255, 0.08)',
                  color: customQuery.trim() ? '#0b1220' : '#64748b',
                  cursor: customQuery.trim() ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Send size={13} />
              </button>
            </form>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: '#64748b' }}>
              <span>{modKey}+\ hide · {modKey}+Alt+Shift+S screenshot</span>
              <span>
                {currentAnswer?.model ? `${currentAnswer.model} · ` : ''}
                {latencyMs > 0 ? `${latencyMs}ms` : session?.title || 'SideBro'}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
