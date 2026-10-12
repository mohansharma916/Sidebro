import React, { useState, useEffect } from 'react';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Maximize2,
  Minimize2,
  Mic,
  Volume2,
  Sparkles,
  Zap,
  Copy,
  Check,
  Send,
  Eye,
  ChevronLeft,
  ChevronRight,
  Code,
  FileText,
  Sliders,
  ExternalLink,
} from 'lucide-react';
import {
  AnswerLengthMode,
  DetectedQuestion,
  GeneratedAnswer,
  SessionState,
  TranscriptItem,
} from '../types';

interface FloatingOverlayViewProps {
  session: SessionState | null;
  latencyMs: number;
  isMicActive: boolean;
  isSystemAudioActive: boolean;
  micVolume: number;
  systemVolume: number;
  vadActive: boolean;
  transcripts: TranscriptItem[];
  questions: DetectedQuestion[];
  currentQuestion: DetectedQuestion | null;
  currentAnswer: GeneratedAnswer | null;
  isProtected: boolean;
  onToggleProtection: () => void;
  onExitFloatingMode: () => void;
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
  transcripts,
  questions,
  currentQuestion,
  currentAnswer,
  isProtected,
  onToggleProtection,
  onExitFloatingMode,
  onLengthModeChange,
  onTriggerModifier,
  onManualAsk,
}) => {
  const [opacityLevel, setOpacityLevel] = useState<number>(1.0);
  const [copied, setCopied] = useState(false);
  const [customQuery, setCustomQuery] = useState('');
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState<number>(-1);

  // Sync selected index when new questions arrive
  useEffect(() => {
    if (questions.length > 0) {
      setSelectedQuestionIndex(questions.length - 1);
    }
  }, [questions.length]);

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
  };

  // Extract candidate speaker tag
  const latestTranscript = transcripts[transcripts.length - 1];

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
              fontSize: '0.68rem',
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

      {/* Audio & VAD Micro-Indicator Strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '5px 12px',
          background: 'rgba(10, 15, 24, 0.8)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          fontSize: '0.68rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Candidate Mic */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Mic size={11} color={isMicActive ? '#10b981' : '#64748b'} />
            <span style={{ color: isMicActive ? '#e2e8f0' : '#64748b' }}>YOU</span>
            {isMicActive && (
              <div
                style={{
                  width: '28px',
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
                    background: '#10b981',
                    transition: 'width 0.1s ease',
                  }}
                />
              </div>
            )}
          </div>

          {/* Interviewer Audio */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Volume2 size={11} color={isSystemAudioActive ? '#00f2fe' : '#64748b'} />
            <span style={{ color: isSystemAudioActive ? '#e2e8f0' : '#64748b' }}>INTERVIEWER</span>
            {isSystemAudioActive && (
              <div
                style={{
                  width: '28px',
                  height: '4px',
                  background: 'rgba(255,255,255,0.1)',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, systemVolume * 100)}%`,
                    height: '100%',
                    background: '#00f2fe',
                    transition: 'width 0.1s ease',
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Latency & Protection Notice */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b' }}>
          <span>{latencyMs > 0 ? `${latencyMs}ms` : 'Ready'}</span>
          <span>•</span>
          <span style={{ color: '#10b981' }}>Meet/Zoom Blind</span>
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
              <span style={{ color: '#64748b', fontStyle: 'italic', fontWeight: 400 }}>
                Listening for questions... Start speaking or simulate speech.
              </span>
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
          }}
        >
          {/* Header of Answer with Copy Button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Sparkles size={14} color="#00f2fe" />
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#00f2fe', textTransform: 'uppercase' }}>
                AI Wingman Answer
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
                <div style={{ marginBottom: '8px', color: '#f1f5f9', fontWeight: 500 }}>
                  {currentAnswer.directAnswer}
                </div>

                {/* Key Points Bullets */}
                {currentAnswer.keyPoints && currentAnswer.keyPoints.length > 0 && (
                  <ul style={{ paddingLeft: '16px', margin: '6px 0', color: '#cbd5e1' }}>
                    {currentAnswer.keyPoints.map((pt, idx) => (
                      <li key={idx} style={{ marginBottom: '4px' }}>
                        {pt}
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
                    {currentAnswer.fullContent}
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
                <span>Sub-second answers appear here when questions are asked.</span>
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

        {/* Live Audio Transcript Snippet (Latest) */}
        {latestTranscript && (
          <div
            style={{
              fontSize: '0.68rem',
              color: '#94a3b8',
              padding: '4px 8px',
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '6px',
              borderLeft: `2px solid ${latestTranscript.speaker === 'YOU' ? '#10b981' : '#00f2fe'}`,
            }}
          >
            <strong style={{ color: latestTranscript.speaker === 'YOU' ? '#10b981' : '#00f2fe' }}>
              {latestTranscript.speaker}:{' '}
            </strong>
            <span>{latestTranscript.text}</span>
          </div>
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
          placeholder="Ask AI silently or paste prompt..."
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
