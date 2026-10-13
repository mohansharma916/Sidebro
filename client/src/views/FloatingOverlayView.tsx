import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Maximize2,
  Mic,
  MicOff,
  Volume2,
  Sparkles,
  Zap,
  Copy,
  Check,
  Send,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Play,
  RotateCcw,
} from 'lucide-react';
import {
  AnswerLengthMode,
  DetectedQuestion,
  GeneratedAnswer,
  SessionState,
  TranscriptItem,
} from '../types';
import { FormattedText } from '../components/FormattedText';

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

export const FloatingOverlayView: React.FC<FloatingOverlayViewProps> = ({
  session,
  latencyMs,
  isMicActive,
  isSystemAudioActive,
  micVolume,
  systemVolume,
  vadActive,
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
  onLengthModeChange,
  onTriggerModifier,
  onManualAsk,
}) => {
  const [activeTab, setActiveTab] = useState<'ANSWERS' | 'TRANSCRIPTS'>('ANSWERS');
  const [opacityLevel, setOpacityLevel] = useState<number>(1.0);
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

  const handleOpacityChange = (level: number) => {
    setOpacityLevel(level);
    if (window.electronAPI?.setWindowOpacity) {
      window.electronAPI.setWindowOpacity(level);
    }
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
  };

  const sampleQuestions = [
    'How does React reconciliation work?',
    'Explain microservices vs monolith architecture',
    'How to design a distributed rate limiter?',
  ];

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: `rgba(8, 11, 17, ${opacityLevel < 1 ? opacityLevel * 0.95 : 0.98})`,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        color: '#f8fafc',
        fontFamily: 'var(--font-sans)',
        overflow: 'hidden',
        border: '1px solid rgba(0, 242, 254, 0.25)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
      }}
    >
      {/* Draggable Titlebar & Stealth Status Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'rgba(15, 23, 42, 0.9)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          cursor: 'grab',
          WebkitAppRegion: 'drag',
          userSelect: 'none',
        } as React.CSSProperties}
      >
        {/* Stealth Badge & Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '3px 8px',
              borderRadius: '20px',
              fontSize: '0.66rem',
              fontWeight: 700,
              background: isProtected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: isProtected ? '#10b981' : '#ef4444',
              border: `1px solid ${isProtected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              cursor: 'pointer',
            }}
            onClick={onToggleProtection}
            title={
              isProtected
                ? 'Protected: Invisible to Google Meet, Zoom, Teams & screen shares. Click to toggle.'
                : 'Unprotected: Screen capture protection disabled. Click to enable.'
            }
          >
            {isProtected ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
            <span>{isProtected ? 'STEALTH ACTIVE' : 'STEALTH OFF'}</span>
          </div>

          <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>
            {session?.title || 'SideBro Copilot'}
          </span>
        </div>

        {/* Controls: Opacity & Window Restore */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* Opacity Pill Buttons */}
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.4)', borderRadius: '6px', padding: '2px' }}>
            {[1.0, 0.85, 0.7].map((lvl) => (
              <button
                key={lvl}
                onClick={() => handleOpacityChange(lvl)}
                style={{
                  background: opacityLevel === lvl ? 'rgba(0, 242, 254, 0.2)' : 'transparent',
                  color: opacityLevel === lvl ? '#00f2fe' : '#64748b',
                  border: 'none',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                title={`Window Opacity: ${Math.round(lvl * 100)}%`}
              >
                {Math.round(lvl * 100)}%
              </button>
            ))}
          </div>

          {/* Restore / Expand to Full Window */}
          <button
            onClick={onExitFloatingMode}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              color: '#cbd5e1',
              padding: '4px 6px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Expand to Full Window"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      {/* Audio & Mic Controls Strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          background: 'rgba(10, 15, 24, 0.95)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          fontSize: '0.68rem',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Microphone On/Off Toggle Button */}
          <button
            onClick={onToggleMicrophone}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: isMicActive ? 'rgba(16, 185, 129, 0.18)' : 'rgba(239, 68, 68, 0.18)',
              border: `1px solid ${isMicActive ? '#10b981' : '#ef4444'}`,
              color: isMicActive ? '#10b981' : '#ef4444',
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '0.65rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
            title={isMicActive ? 'Microphone is listening. Click to mute.' : 'Microphone is OFF. Click to start listening.'}
          >
            {isMicActive ? <Mic size={11} /> : <MicOff size={11} />}
            <span>{isMicActive ? 'MIC ACTIVE' : 'MIC OFF'}</span>
          </button>

          {/* Mic Role Toggle (Interviewer Q&A vs Candidate) */}
          <button
            onClick={onToggleMicRole}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: micRole === 'OTHER' ? 'rgba(0, 242, 254, 0.15)' : 'rgba(255, 255, 255, 0.06)',
              border: `1px solid ${micRole === 'OTHER' ? '#00f2fe' : 'rgba(255, 255, 255, 0.12)'}`,
              color: micRole === 'OTHER' ? '#00f2fe' : '#94a3b8',
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '0.65rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
            title="Toggle whether microphone speech triggers interview questions (Interviewer mode) or represents your answers (Candidate mode)."
          >
            <span>Mic: {micRole === 'OTHER' ? 'Interviewer (Q&A)' : 'Candidate (YOU)'}</span>
          </button>

          {/* Volume Level Bar */}
          {isMicActive && (
            <div
              style={{
                width: '32px',
                height: '4px',
                background: 'rgba(255,255,255,0.1)',
                borderRadius: '2px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, micVolume * 100)}%`,
                  height: '100%',
                  background: micRole === 'OTHER' ? '#00f2fe' : '#10b981',
                  transition: 'width 0.1s ease',
                }}
              />
            </div>
          )}
        </div>

        {/* Tab Switcher: Q&A Copilot vs Live Transcripts */}
        <div style={{ display: 'flex', background: 'rgba(0,0,0,0.5)', borderRadius: '6px', padding: '2px' }}>
          <button
            onClick={() => setActiveTab('ANSWERS')}
            style={{
              background: activeTab === 'ANSWERS' ? 'rgba(0, 242, 254, 0.2)' : 'transparent',
              color: activeTab === 'ANSWERS' ? '#00f2fe' : '#64748b',
              border: 'none',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '0.64rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Sparkles size={10} /> Q&A Answers
          </button>
          <button
            onClick={() => setActiveTab('TRANSCRIPTS')}
            style={{
              background: activeTab === 'TRANSCRIPTS' ? 'rgba(0, 242, 254, 0.2)' : 'transparent',
              color: activeTab === 'TRANSCRIPTS' ? '#00f2fe' : '#64748b',
              border: 'none',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '0.64rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <MessageSquare size={10} /> Transcripts ({transcripts.length})
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {activeTab === 'TRANSCRIPTS' ? (
          /* Full Live Transcripts Stream */
          <div
            style={{
              flex: 1,
              background: 'rgba(10, 15, 24, 0.85)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '10px',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              gap: '8px',
            }}
          >
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
              Live Speech Transcripts ({transcripts.length} utterances)
            </div>

            {transcripts.length === 0 ? (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#64748b',
                  fontSize: '0.75rem',
                  textAlign: 'center',
                  padding: '24px',
                }}
              >
                <Mic size={24} style={{ opacity: 0.3, marginBottom: '8px' }} />
                <span>Speak into your microphone or simulate speech. Live words will stream here.</span>
              </div>
            ) : (
              transcripts.map((t, idx) => (
                <div
                  key={t.id || idx}
                  style={{
                    fontSize: '0.78rem',
                    lineHeight: 1.4,
                    padding: '6px 10px',
                    borderRadius: '6px',
                    background: t.speaker === 'OTHER' ? 'rgba(0, 242, 254, 0.05)' : 'rgba(16, 185, 129, 0.05)',
                    borderLeft: `3px solid ${t.speaker === 'OTHER' ? '#00f2fe' : '#10b981'}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                    <span
                      style={{
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        color: t.speaker === 'OTHER' ? '#00f2fe' : '#10b981',
                      }}
                    >
                      {t.speaker === 'OTHER' ? 'INTERVIEWER' : 'YOU'}
                    </span>
                    <span style={{ fontSize: '0.6rem', color: '#64748b' }}>
                      {new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  <div style={{ color: '#f1f5f9' }}>{t.text}</div>
                </div>
              ))
            )}
            <div ref={transcriptsEndRef} />
          </div>
        ) : (
          /* Q&A Copilot View */
          <>
            {/* Current / Selected Question Card */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.75)',
                border: '1px solid rgba(0, 242, 254, 0.2)',
                borderRadius: '10px',
                padding: '10px 12px',
                position: 'relative',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '6px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      background: 'rgba(0, 242, 254, 0.15)',
                      color: '#00f2fe',
                      padding: '2px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    {displayedQuestion?.type || 'Live Question'}
                  </span>
                  {questions.length > 1 && (
                    <span style={{ fontSize: '0.65rem', color: '#64748b' }}>
                      ({(selectedQuestionIndex >= 0 ? selectedQuestionIndex : questions.length - 1) + 1} of {questions.length})
                    </span>
                  )}
                </div>

                {/* Pagination between questions if multiple exist */}
                {questions.length > 1 && (
                  <div style={{ display: 'flex', gap: '2px' }}>
                    <button
                      onClick={() => setSelectedQuestionIndex(Math.max(0, (selectedQuestionIndex >= 0 ? selectedQuestionIndex : questions.length - 1) - 1))}
                      disabled={(selectedQuestionIndex >= 0 ? selectedQuestionIndex : questions.length - 1) === 0}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        padding: '2px',
                      }}
                    >
                      <ChevronLeft size={13} />
                    </button>
                    <button
                      onClick={() => setSelectedQuestionIndex(Math.min(questions.length - 1, (selectedQuestionIndex >= 0 ? selectedQuestionIndex : questions.length - 1) + 1))}
                      disabled={(selectedQuestionIndex >= 0 ? selectedQuestionIndex : questions.length - 1) === questions.length - 1}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        padding: '2px',
                      }}
                    >
                      <ChevronRight size={13} />
                    </button>
                  </div>
                )}
              </div>

              <div
                style={{
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  color: '#f8fafc',
                  lineHeight: 1.4,
                }}
              >
                {displayedQuestion ? (
                  displayedQuestion.questionText
                ) : (
                  <div>
                    <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
                      Listening for questions via microphone... Or test instantly:
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                      {sampleQuestions.map((sq, i) => (
                        <button
                          key={i}
                          onClick={() => onManualAsk(sq)}
                          style={{
                            background: 'rgba(0, 242, 254, 0.1)',
                            border: '1px solid rgba(0, 242, 254, 0.25)',
                            color: '#38bdf8',
                            fontSize: '0.66rem',
                            fontWeight: 600,
                            padding: '3px 8px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          ⚡ {sq}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Streaming Answer Section */}
            <div
              style={{
                flex: 1,
                background: 'rgba(10, 15, 24, 0.85)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '10px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                minHeight: '160px',
              }}
            >
              {/* Header of Answer with Copy Button */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sparkles size={14} color="#00f2fe" />
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#00f2fe', textTransform: 'uppercase' }}>
                    AI Wingman Answer {currentAnswer?.model ? `(${currentAnswer.model})` : ''}
                  </span>
                </div>

                {currentAnswer && (
                  <button
                    onClick={handleCopyAnswer}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: copied ? '#10b981' : '#94a3b8',
                      padding: '3px 8px',
                      borderRadius: '6px',
                      fontSize: '0.65rem',
                      cursor: 'pointer',
                    }}
                  >
                    {copied ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
              </div>

              {/* Answer Body */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  fontSize: '0.82rem',
                  lineHeight: 1.5,
                  color: '#e2e8f0',
                }}
              >
                {currentAnswer ? (
                  <>
                    {/* Direct Answer */}
                    {currentAnswer.directAnswer && (
                      <div style={{ marginBottom: '8px', color: '#f1f5f9', fontWeight: 500 }}>
                        <FormattedText text={currentAnswer.directAnswer} />
                      </div>
                    )}

                    {/* Key Points Bullets */}
                    {currentAnswer.keyPoints && currentAnswer.keyPoints.length > 0 && (
                      <ul style={{ paddingLeft: '16px', margin: '6px 0', color: '#cbd5e1' }}>
                        {currentAnswer.keyPoints.map((pt, idx) => (
                          <li key={idx} style={{ marginBottom: '4px' }}>
                            <FormattedText text={pt} />
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Code Snippet or Example if present */}
                    {currentAnswer.exampleOrSnippet && (
                      <pre
                        style={{
                          background: '#040711',
                          border: '1px solid rgba(0, 242, 254, 0.15)',
                          borderRadius: '6px',
                          padding: '8px',
                          fontSize: '0.72rem',
                          fontFamily: 'var(--font-mono)',
                          color: '#38bdf8',
                          overflowX: 'auto',
                          margin: '8px 0',
                        }}
                      >
                        <code>{currentAnswer.exampleOrSnippet}</code>
                      </pre>
                    )}

                    {/* Full streaming markdown if direct answer is not yet parsed */}
                    {!currentAnswer.directAnswer && currentAnswer.fullContent && (
                      <div style={{ whiteSpace: 'pre-wrap', color: '#cbd5e1' }}>
                        <FormattedText text={currentAnswer.fullContent} />
                      </div>
                    )}
                  </>
                ) : (
                  <div
                    style={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#64748b',
                      fontSize: '0.75rem',
                      textAlign: 'center',
                      padding: '16px',
                    }}
                  >
                    <Zap size={22} style={{ opacity: 0.3, marginBottom: '8px' }} />
                    <span>Real-time AI answers stream here when questions are asked or typed.</span>
                  </div>
                )}
              </div>

              {/* Quick Modifier Action Chips */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  flexWrap: 'wrap',
                  paddingTop: '6px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                {[
                  { id: 'shorter' as const, label: 'Shorter' },
                  { id: 'expand' as const, label: 'Explain' },
                  { id: 'example' as const, label: 'Example' },
                  { id: 'technical_detail' as const, label: 'Tech Detail' },
                  { id: 'star' as const, label: 'STAR Story' },
                ].map((chip) => (
                  <button
                    key={chip.id}
                    onClick={() => onTriggerModifier(chip.id)}
                    disabled={!currentAnswer}
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      color: currentAnswer ? '#94a3b8' : '#475569',
                      padding: '3px 7px',
                      borderRadius: '4px',
                      fontSize: '0.62rem',
                      fontWeight: 600,
                      cursor: currentAnswer ? 'pointer' : 'not-allowed',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Quick Silent Ask Input Footer */}
      <form
        onSubmit={handleManualSubmit}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 12px',
          background: 'rgba(15, 23, 42, 0.95)',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <input
          type="text"
          value={customQuery}
          onChange={(e) => setCustomQuery(e.target.value)}
          placeholder="Ask AI question silently or paste prompt..."
          style={{
            flex: 1,
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '6px',
            padding: '6px 10px',
            fontSize: '0.75rem',
            color: '#f8fafc',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={!customQuery.trim()}
          style={{
            background: customQuery.trim() ? '#00f2fe' : 'rgba(255, 255, 255, 0.1)',
            color: customQuery.trim() ? '#051020' : '#64748b',
            border: 'none',
            borderRadius: '6px',
            padding: '6px 10px',
            cursor: customQuery.trim() ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Send size={12} />
        </button>
      </form>
    </div>
  );
};
