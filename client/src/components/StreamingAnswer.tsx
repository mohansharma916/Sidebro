import React, { useState } from 'react';
import {
  Sparkles,
  Zap,
  BookOpen,
  Code,
  Sliders,
  Bookmark,
  Check,
  Copy,
  ChevronRight,
  HelpCircle,
  Clock,
  Layers,
} from 'lucide-react';
import { AnswerLengthMode, DetectedQuestion, GeneratedAnswer, QuestionCategory } from '../types';

interface StreamingAnswerProps {
  currentQuestion: DetectedQuestion | null;
  currentAnswer: GeneratedAnswer | null;
  lengthMode: AnswerLengthMode;
  onLengthModeChange: (mode: AnswerLengthMode) => void;
  onTriggerModifier: (modifier: 'shorter' | 'expand' | 'example' | 'technical_detail' | 'star' | 'alternative') => void;
  onBookmarkAnswer?: (answer: GeneratedAnswer) => void;
  onSelectFollowUp?: (questionText: string) => void;
}

export const StreamingAnswer: React.FC<StreamingAnswerProps> = ({
  currentQuestion,
  currentAnswer,
  lengthMode,
  onLengthModeChange,
  onTriggerModifier,
  onBookmarkAnswer,
  onSelectFollowUp,
}) => {
  const [copied, setCopied] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);

  const getCategoryBadgeClass = (category?: QuestionCategory) => {
    switch (category) {
      case 'Technical': return 'badge-technical';
      case 'System Design': return 'badge-system';
      case 'Behavioral': return 'badge-behavioral';
      case 'Coding': return 'badge-coding';
      case 'Follow-up': return 'badge-followup';
      default: return 'badge-technical';
    }
  };

  const handleCopy = () => {
    if (!currentAnswer) return;
    navigator.clipboard.writeText(currentAnswer.fullContent || currentAnswer.directAnswer);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleBookmark = () => {
    if (!currentAnswer) return;
    onBookmarkAnswer?.(currentAnswer);
    setBookmarked(true);
    setTimeout(() => setBookmarked(false), 2000);
  };

  if (!currentQuestion && !currentAnswer) {
    return (
      <div className="glass-panel" style={{
        padding: '48px 24px',
        textAlign: 'center',
        color: '#64748b',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '14px',
      }}>
        <div style={{
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'rgba(0, 242, 254, 0.08)',
          border: '1px solid rgba(0, 242, 254, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#00f2fe',
        }}>
          <Sparkles size={24} />
        </div>
        <div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '6px' }}>
            SideBro is Listening...
          </h3>
          <p style={{ fontSize: '0.86rem', maxWidth: '380px', margin: '0 auto', lineHeight: 1.5 }}>
            Conduct your call on the primary device. SideBro detects questions instantly and streams answers right here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 1. CURRENT QUESTION CARD (PRD Section 16 & 18: Large and highly visible) */}
      <div className="glass-panel" style={{
        padding: '20px 24px',
        borderLeft: '4px solid #00f2fe',
        background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.05) 0%, rgba(17, 24, 39, 0.8) 100%)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className={`badge ${getCategoryBadgeClass(currentQuestion?.type)}`}>
              {currentQuestion?.type || 'Question'}
            </span>
            <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={11} /> Detected Live
            </span>
          </div>

          {currentAnswer?.firstTokenLatencyMs && (
            <span style={{
              fontSize: '0.74rem',
              color: '#10b981',
              fontFamily: 'var(--font-mono)',
              background: 'rgba(16, 185, 129, 0.1)',
              padding: '2px 8px',
              borderRadius: '4px',
            }}>
              ⚡ {currentAnswer.firstTokenLatencyMs}ms
            </span>
          )}
        </div>

        <h2 style={{
          fontSize: '1.35rem',
          fontWeight: 700,
          color: '#ffffff',
          lineHeight: 1.4,
          letterSpacing: '-0.01em',
        }}>
          {currentQuestion?.questionText || currentAnswer?.questionText}
        </h2>
      </div>

      {/* 2. CONTROLS BAR: Answer Length Modes & Action Chips (PRD Section 18 & 19) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '10px',
        padding: '0 4px',
      }}>
        {/* Length Modes: Quick / Normal / Detailed */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.05)',
          padding: '3px',
          borderRadius: '10px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}>
          {(['quick', 'normal', 'detailed'] as AnswerLengthMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => onLengthModeChange(mode)}
              style={{
                background: lengthMode === mode ? '#00f2fe' : 'transparent',
                color: lengthMode === mode ? '#06101e' : '#94a3b8',
                border: 'none',
                padding: '5px 12px',
                borderRadius: '7px',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                textTransform: 'capitalize',
              }}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Quick AI Action Chips (PRD Section 18) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button onClick={() => onTriggerModifier('shorter')} className="chip" title="Condense answer into 2 sentences">
            <Zap size={12} color="#00f2fe" /> Shorter
          </button>
          <button onClick={() => onTriggerModifier('example')} className="chip" title="Add code or concrete example">
            <Code size={12} color="#10b981" /> Example
          </button>
          <button onClick={() => onTriggerModifier('technical_detail')} className="chip" title="Deep dive into internals">
            <Layers size={12} color="#c084fc" /> Tech Detail
          </button>
          <button onClick={() => onTriggerModifier('star')} className="chip" title="Format as STAR">
            <Sliders size={12} color="#f59e0b" /> STAR
          </button>
          <button onClick={() => onTriggerModifier('alternative')} className="chip" title="Compare with alternative approach">
            <BookOpen size={12} color="#38bdf8" /> Alternative
          </button>
        </div>
      </div>

      {/* 3. SUGGESTED ANSWER CARD (PRD Section 16 & 18: Readable from a distance) */}
      <div className="glass-panel" style={{ padding: '24px', position: 'relative' }}>
        {/* Top Header of Suggested Answer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={16} color="#00f2fe" />
            <span style={{ fontSize: '0.84rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#00f2fe' }}>
              Suggested Answer
            </span>
            {!currentAnswer?.isComplete && (
              <span style={{ fontSize: '0.74rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span className="status-dot active" style={{ width: '6px', height: '6px' }} /> Streaming...
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={handleCopy}
              className="btn btn-secondary btn-sm"
              title="Copy Answer"
            >
              {copied ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
              <span style={{ fontSize: '0.74rem' }}>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              onClick={handleBookmark}
              className="btn btn-secondary btn-sm"
              title="Save Note / Bookmark"
            >
              {bookmarked ? <Check size={13} color="#10b981" /> : <Bookmark size={13} />}
              <span style={{ fontSize: '0.74rem' }}>{bookmarked ? 'Saved' : 'Save'}</span>
            </button>
          </div>
        </div>

        {/* Direct Answer Callout Box */}
        {currentAnswer?.directAnswer && (
          <div style={{
            background: 'rgba(0, 242, 254, 0.08)',
            border: '1px solid rgba(0, 242, 254, 0.25)',
            borderRadius: '12px',
            padding: '14px 18px',
            marginBottom: '18px',
          }}>
            <span style={{
              display: 'block',
              fontSize: '0.72rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#38bdf8',
              marginBottom: '4px',
            }}>
              Direct Summary (5-sec scan)
            </span>
            <p style={{
              fontSize: '1.05rem',
              fontWeight: 500,
              color: '#f8fafc',
              lineHeight: 1.5,
            }}>
              {currentAnswer.directAnswer}
            </p>
          </div>
        )}

        {/* Key Points (PRD Section 18: Prefer bullets over long paragraphs) */}
        {currentAnswer?.keyPoints && currentAnswer.keyPoints.length > 0 && (
          <div style={{ marginBottom: '18px' }}>
            <span style={{
              display: 'block',
              fontSize: '0.74rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#94a3b8',
              marginBottom: '8px',
            }}>
              Key Points
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {currentAnswer.keyPoints.map((point, idx) => {
                // Parse markdown bold if present
                const parts = point.split(/(\*\*.*?\*\*)/g);
                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      fontSize: '0.94rem',
                      color: '#cbd5e1',
                      lineHeight: 1.55,
                    }}
                  >
                    <span style={{ color: '#00f2fe', marginTop: '3px' }}>•</span>
                    <div>
                      {parts.map((p, pIdx) => {
                        if (p.startsWith('**') && p.endsWith('**')) {
                          return (
                            <strong key={pIdx} style={{ color: '#ffffff', fontWeight: 600 }}>
                              {p.slice(2, -2)}
                            </strong>
                          );
                        }
                        return p;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Code / Architecture Snippet */}
        {currentAnswer?.exampleOrSnippet && (
          <div style={{ marginBottom: '18px' }}>
            <span style={{
              display: 'block',
              fontSize: '0.74rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#94a3b8',
              marginBottom: '6px',
            }}>
              Code / Pattern Example
            </span>
            <pre style={{
              background: '#04060a',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '10px',
              padding: '12px 16px',
              overflowX: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.82rem',
              color: '#38bdf8',
              lineHeight: 1.5,
            }}>
              <code>{currentAnswer.exampleOrSnippet}</code>
            </pre>
          </div>
        )}

        {/* Raw / Streaming Content Markdown fallback */}
        {!currentAnswer?.directAnswer && currentAnswer?.fullContent && (
          <div className="markdown-body" style={{ color: '#cbd5e1' }}>
            {currentAnswer.fullContent}
            {!currentAnswer.isComplete && <span className="streaming-cursor" />}
          </div>
        )}

        {!currentAnswer?.isComplete && currentAnswer?.directAnswer && (
          <span className="streaming-cursor" />
        )}
      </div>

      {/* 4. ANTICIPATED FOLLOW-UP QUESTIONS (PRD Section 42) */}
      {currentAnswer?.followUpQuestions && currentAnswer.followUpQuestions.length > 0 && (
        <div className="glass-panel" style={{ padding: '18px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <HelpCircle size={15} color="#f59e0b" />
            <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#f59e0b' }}>
              Possible Follow-Up Questions
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {currentAnswer.followUpQuestions.map((q, idx) => (
              <button
                key={idx}
                onClick={() => onSelectFollowUp?.(q)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  textAlign: 'left',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  color: '#cbd5e1',
                  fontSize: '0.88rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(0, 242, 254, 0.08)';
                  e.currentTarget.style.borderColor = 'rgba(0, 242, 254, 0.3)';
                  e.currentTarget.style.color = '#ffffff';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
                  e.currentTarget.style.color = '#cbd5e1';
                }}
              >
                <span>{q}</span>
                <ChevronRight size={14} color="#64748b" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
