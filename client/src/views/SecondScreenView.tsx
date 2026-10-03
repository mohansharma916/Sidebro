import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  MessageSquare,
  FileText,
  Bookmark,
  BarChart3,
  Search,
  CheckCircle2,
  Trash2,
  Plus,
  Zap,
} from 'lucide-react';
import {
  AnswerLengthMode,
  ContextProfile,
  DetectedQuestion,
  GeneratedAnswer,
  SessionNote,
  SessionState,
  TranscriptItem,
} from '../types';
import { DeviceHealthBar } from '../components/DeviceHealthBar';
import { StreamingAnswer } from '../components/StreamingAnswer';
import { TranscriptFeed } from '../components/TranscriptFeed';
import { AskAIModal } from '../components/AskAIModal';
import { PostSessionView } from './PostSessionView';

interface SecondScreenViewProps {
  session: SessionState;
  latencyMs: number;
  transcripts: TranscriptItem[];
  questions: DetectedQuestion[];
  currentQuestion: DetectedQuestion | null;
  currentAnswer: GeneratedAnswer | null;
  notes: SessionNote[];
  onLengthModeChange: (mode: AnswerLengthMode) => void;
  onTriggerModifier: (modifier: 'shorter' | 'expand' | 'example' | 'technical_detail' | 'star' | 'alternative') => void;
  onManualAsk: (questionText: string) => void;
  onSaveNote: (text: string, questionId?: string) => void;
  onEndSession: () => void;
}

export const SecondScreenView: React.FC<SecondScreenViewProps> = ({
  session,
  latencyMs,
  transcripts,
  questions,
  currentQuestion,
  currentAnswer,
  notes,
  onLengthModeChange,
  onTriggerModifier,
  onManualAsk,
  onSaveNote,
  onEndSession,
}) => {
  const [activeTab, setActiveTab] = useState<'LIVE' | 'TRANSCRIPT' | 'CONTEXT' | 'NOTES' | 'ANALYTICS'>('LIVE');
  const [newNoteText, setNewNoteText] = useState('');

  // Automatically switch to Analytics / Review tab when session is ended
  useEffect(() => {
    if (session.status === 'ended') {
      setActiveTab('ANALYTICS');
    }
  }, [session.status]);

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim()) return;
    onSaveNote(newNoteText.trim(), currentQuestion?.id);
    setNewNoteText('');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-main)' }}>
      {/* Device Health Status Bar (PRD Section 45) */}
      <DeviceHealthBar session={session} latencyMs={latencyMs} isPrimary={false} />

      {/* Navigation Bar (PRD Section 17) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        background: 'rgba(13, 18, 29, 0.95)',
        padding: '8px 12px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        position: 'sticky',
        top: '41px',
        zIndex: 30,
        overflowX: 'auto',
      }}>
        <button
          onClick={() => setActiveTab('LIVE')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: activeTab === 'LIVE' ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
            border: activeTab === 'LIVE' ? '1px solid rgba(0, 242, 254, 0.4)' : '1px solid transparent',
            color: activeTab === 'LIVE' ? '#00f2fe' : '#94a3b8',
            padding: '7px 16px',
            borderRadius: '8px',
            fontSize: '0.84rem',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <Sparkles size={14} /> LIVE
          {currentAnswer && !currentAnswer.isComplete && (
            <span className="status-dot active" style={{ width: '6px', height: '6px' }} />
          )}
        </button>

        <button
          onClick={() => setActiveTab('TRANSCRIPT')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: activeTab === 'TRANSCRIPT' ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
            border: activeTab === 'TRANSCRIPT' ? '1px solid rgba(0, 242, 254, 0.4)' : '1px solid transparent',
            color: activeTab === 'TRANSCRIPT' ? '#00f2fe' : '#94a3b8',
            padding: '7px 16px',
            borderRadius: '8px',
            fontSize: '0.84rem',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <MessageSquare size={14} /> TRANSCRIPT
          {transcripts.length > 0 && (
            <span style={{
              background: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '999px',
              padding: '1px 6px',
              fontSize: '0.68rem',
            }}>
              {transcripts.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('CONTEXT')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: activeTab === 'CONTEXT' ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
            border: activeTab === 'CONTEXT' ? '1px solid rgba(0, 242, 254, 0.4)' : '1px solid transparent',
            color: activeTab === 'CONTEXT' ? '#00f2fe' : '#94a3b8',
            padding: '7px 16px',
            borderRadius: '8px',
            fontSize: '0.84rem',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <FileText size={14} /> CONTEXT
        </button>

        <button
          onClick={() => setActiveTab('NOTES')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: activeTab === 'NOTES' ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
            border: activeTab === 'NOTES' ? '1px solid rgba(0, 242, 254, 0.4)' : '1px solid transparent',
            color: activeTab === 'NOTES' ? '#00f2fe' : '#94a3b8',
            padding: '7px 16px',
            borderRadius: '8px',
            fontSize: '0.84rem',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <Bookmark size={14} /> NOTES
          {notes.length > 0 && (
            <span style={{
              background: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '999px',
              padding: '1px 6px',
              fontSize: '0.68rem',
            }}>
              {notes.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('ANALYTICS')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: activeTab === 'ANALYTICS' ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
            border: activeTab === 'ANALYTICS' ? '1px solid rgba(0, 242, 254, 0.4)' : '1px solid transparent',
            color: activeTab === 'ANALYTICS' ? '#00f2fe' : '#94a3b8',
            padding: '7px 16px',
            borderRadius: '8px',
            fontSize: '0.84rem',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <BarChart3 size={14} /> REVIEW
        </button>
      </div>

      {/* Main Tab Content Container */}
      <div style={{
        maxWidth: '820px',
        width: '100%',
        margin: '0 auto',
        padding: '16px 14px 40px',
        flex: 1,
      }}>
        {/* TAB 1: LIVE SCREEN (PRD Section 16 & 18) */}
        {activeTab === 'LIVE' && (
          <div>
            <StreamingAnswer
              currentQuestion={currentQuestion}
              currentAnswer={currentAnswer}
              lengthMode={session.answerLength}
              onLengthModeChange={onLengthModeChange}
              onTriggerModifier={onTriggerModifier}
              onBookmarkAnswer={ans => onSaveNote(`[Answer] ${ans.directAnswer}`, ans.questionId)}
              onSelectFollowUp={q => onManualAsk(q)}
            />

            {/* Quick Test Questions Bar for Second Screen testing */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              flexWrap: 'wrap',
              margin: '14px 0',
              padding: '10px 14px',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              borderRadius: '10px',
            }}>
              <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Test Question Stream:</span>
              {[
                { label: 'Bridge vs JSI', q: 'Can you explain the difference between the React Native Bridge and JSI?' },
                { label: 'React Fiber', q: 'How does React Fiber work under the hood?' },
                { label: 'STAR Incident', q: 'Tell me about a time when a critical production incident occurred.' },
                { label: 'Rate Limiter', q: 'How would you design a distributed rate limiter to handle 100k+ RPS?' },
              ].map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onManualAsk(item.q)}
                  className="chip"
                  style={{ fontSize: '0.72rem', color: '#38bdf8' }}
                >
                  <Zap size={11} /> {item.label}
                </button>
              ))}
            </div>

            {/* Manual Ask AI Bar (PRD Section 41) */}
            <AskAIModal onAsk={onManualAsk} />
          </div>
        )}

        {/* TAB 2: TRANSCRIPT SCREEN (PRD Section 27) */}
        {activeTab === 'TRANSCRIPT' && (
          <div className="glass-panel" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc' }}>
                Conversation Transcript
              </h3>
              <span style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                {transcripts.length} total messages
              </span>
            </div>
            <TranscriptFeed
              transcripts={transcripts}
              onAskAboutItem={text => onManualAsk(`Please provide full interview answer for: ${text}`)}
            />
          </div>
        )}

        {/* TAB 3: CONTEXT & RAG (PRD Section 22-25) */}
        {activeTab === 'CONTEXT' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="glass-panel" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <FileText size={18} color="#00f2fe" />
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>
                  Active Context Profile
                </h3>
              </div>
              <p style={{ fontSize: '0.84rem', color: '#94a3b8', marginBottom: '16px' }}>
                This data is parsed into vector chunks and semantically queried for every detected question.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* Resume Section */}
                <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: '#38bdf8' }}>
                      Resume & Experience
                    </span>
                    <span style={{ fontSize: '0.72rem', color: '#10b981' }}>Active</span>
                  </div>
                  <pre style={{
                    fontSize: '0.78rem',
                    color: '#cbd5e1',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'var(--font-mono)',
                    maxHeight: '160px',
                    overflowY: 'auto',
                  }}>
                    {session.profile?.resumeText || 'No resume uploaded.'}
                  </pre>
                </div>

                {/* Job Description */}
                <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: '#a855f7' }}>
                      Job Description
                    </span>
                    <span style={{ fontSize: '0.72rem', color: '#10b981' }}>Active</span>
                  </div>
                  <pre style={{
                    fontSize: '0.78rem',
                    color: '#cbd5e1',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'var(--font-mono)',
                    maxHeight: '130px',
                    overflowY: 'auto',
                  }}>
                    {session.profile?.jobDescriptionText || 'No job description uploaded.'}
                  </pre>
                </div>

                {/* Project Notes & Accomplishments */}
                <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: '#f59e0b' }}>
                      Project Notes & Key Accomplishments
                    </span>
                    <span style={{ fontSize: '0.72rem', color: '#10b981' }}>Active</span>
                  </div>
                  <pre style={{
                    fontSize: '0.78rem',
                    color: '#cbd5e1',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'var(--font-mono)',
                    maxHeight: '130px',
                    overflowY: 'auto',
                  }}>
                    {session.profile?.projectNotesText || 'No project notes.'}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: SESSION NOTES (PRD Section 52) */}
        {activeTab === 'NOTES' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Add Note Form */}
            <div className="glass-panel" style={{ padding: '20px' }}>
              <h3 style={{ fontSize: '0.94rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
                Add Quick Note
              </h3>
              <form onSubmit={handleAddNote} style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="Record an interviewer note, follow-up reminder, or insight..."
                  value={newNoteText}
                  onChange={e => setNewNoteText(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: '#f8fafc',
                    fontSize: '0.84rem',
                    outline: 'none',
                  }}
                />
                <button type="submit" className="btn btn-primary btn-sm">
                  <Plus size={14} /> Add Note
                </button>
              </form>
            </div>

            {/* Notes List */}
            <div className="glass-panel" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <h3 style={{ fontSize: '0.94rem', fontWeight: 700, color: '#f8fafc' }}>
                  Saved Notes & Bookmarks ({notes.length})
                </h3>
              </div>

              {notes.length === 0 ? (
                <p style={{ fontSize: '0.84rem', color: '#64748b', textAlign: 'center', padding: '24px 0' }}>
                  No saved notes yet. Bookmark answers or add notes above.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {notes.map(n => (
                    <div
                      key={n.id}
                      style={{
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.07)',
                        borderRadius: '8px',
                        padding: '12px 14px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '0.7rem', color: '#00f2fe', fontFamily: 'var(--font-mono)' }}>
                          {new Date(n.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.88rem', color: '#e2e8f0', lineHeight: 1.5 }}>
                        {n.text}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: ANALYTICS & POST-SESSION REVIEW (PRD Section 49-51) */}
        {activeTab === 'ANALYTICS' && (
          <PostSessionView
            sessionId={session.id}
            onEndSession={onEndSession}
            isSessionActive={session.status === 'active'}
          />
        )}
      </div>
    </div>
  );
};
